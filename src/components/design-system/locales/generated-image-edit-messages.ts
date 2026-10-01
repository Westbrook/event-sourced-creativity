export type GeneratedImageEditCopy = Readonly<{
  action: string; title: string; previewTitle: string; help: string; loading: string; preparing: string;
  adoption: string; adopt: string; adopting: string; adoptionRemains: string;
  previewAlt: string; previewHelp: string; save: string; saving: string;
  back: string; cancel: string; done: string; check: string; checking: string;
  saved: string; unchanged: string; unconfirmed: string; pendingClose: string;
  unavailable: string; invalid: string; source_changed: string; forbidden: string;
}>;

const en: GeneratedImageEditCopy = {
  action: "Edit image", title: "Edit this image", previewTitle: "Preview edited image",
  help: "Compose with existing image references, then preview and save. Saving preserves the original image. It does not generate a new image or approve this output.",
  loading: "Loading the current image…", preparing: "Preparing the image preview…",
  adoption: "To edit this image, first add it as a reference in this document. Opening this dialog has not changed the document.",
  adopt: "Add as context and edit", adopting: "Adding the image as context…",
  adoptionRemains: "An image added as context remains in the document even if you cancel editing. Cancel does not save an edited image.",
  previewAlt: "Edited image before saving", previewHelp: "This is the image that will be saved. The original title, notes and generation details remain unchanged. This preview has not received an independent review.",
  save: "Save edited image", saving: "Saving edited image…", back: "Back to edit", cancel: "Cancel", done: "Done",
  check: "Check this Save", checking: "Checking this Save…",
  saved: "The edited image is saved as a new revision. It is not approved.",
  unchanged: "The image bytes are unchanged. No new revision was created.",
  unconfirmed: "The Save result is unconfirmed. No second upload has been sent. Check the original operation before starting another edit.",
  pendingClose: "Closing does not cancel a Save that has already been submitted.",
  unavailable: "This image could not be loaded or prepared. Close the editor and reopen the current output to try again.",
  invalid: "The preview could not be prepared from this composition. Keep the original image in the composition and check its settings.",
  source_changed: "This output has changed. Reopen its current revision before editing again.",
  forbidden: "You no longer have permission to edit this image.",
};
const fr: GeneratedImageEditCopy = {
  action: "Modifier l’image", title: "Modifier cette image", previewTitle: "Aperçu de l’image modifiée",
  help: "Composez avec les images de référence existantes, puis prévisualisez et enregistrez. L’image originale est conservée. Cette opération ne génère pas de nouvelle image et n’approuve pas ce résultat.",
  loading: "Chargement de l’image actuelle…", preparing: "Préparation de l’aperçu…",
  adoption: "Pour modifier cette image, ajoutez-la d’abord comme référence dans ce document. L’ouverture de cette boîte de dialogue n’a pas modifié le document.",
  adopt: "Ajouter au contexte et modifier", adopting: "Ajout de l’image au contexte…",
  adoptionRemains: "Une image ajoutée au contexte reste dans le document même si vous annulez la modification. Annuler n’enregistre pas d’image modifiée.",
  previewAlt: "Image modifiée avant l’enregistrement", previewHelp: "C’est l’image qui sera enregistrée. Le titre, les notes et les détails de génération d’origine restent inchangés. Cet aperçu n’a pas fait l’objet d’une revue indépendante.",
  save: "Enregistrer l’image modifiée", saving: "Enregistrement de l’image modifiée…", back: "Revenir à la modification", cancel: "Annuler", done: "Terminé",
  check: "Vérifier cet enregistrement", checking: "Vérification de cet enregistrement…",
  saved: "L’image modifiée est enregistrée dans une nouvelle révision. Elle n’est pas approuvée.",
  unchanged: "Les octets de l’image sont inchangés. Aucune nouvelle révision n’a été créée.",
  unconfirmed: "Le résultat de l’enregistrement n’est pas confirmé. Aucun second téléversement n’a été envoyé. Vérifiez l’opération initiale avant de commencer une autre modification.",
  pendingClose: "La fermeture n’annule pas un enregistrement déjà soumis.",
  unavailable: "Impossible de charger ou de préparer cette image. Fermez l’éditeur et rouvrez le résultat actuel pour réessayer.",
  invalid: "Impossible de préparer l’aperçu de cette composition. Conservez l’image originale dans la composition et vérifiez ses réglages.",
  source_changed: "Ce résultat a changé. Rouvrez sa révision actuelle avant de le modifier à nouveau.",
  forbidden: "Vous n’avez plus l’autorisation de modifier cette image.",
};
const ar: GeneratedImageEditCopy = {
  action: "تعديل الصورة", title: "تعديل هذه الصورة", previewTitle: "معاينة الصورة المعدلة",
  help: "أنشئ تركيبًا باستخدام الصور المرجعية الموجودة، ثم عاينه واحفظه. تُحفظ الصورة الأصلية. لا تُولّد هذه العملية صورة جديدة ولا تعتمد هذا الناتج.",
  loading: "جارٍ تحميل الصورة الحالية…", preparing: "جارٍ إعداد معاينة الصورة…",
  adoption: "لتعديل هذه الصورة، أضفها أولًا كمرجع في هذا المستند. لم يؤد فتح هذا الحوار إلى تغيير المستند.",
  adopt: "إضافة إلى السياق والتعديل", adopting: "جارٍ إضافة الصورة إلى السياق…",
  adoptionRemains: "تبقى الصورة المضافة إلى السياق في المستند حتى إذا ألغيت التعديل. لا يؤدي الإلغاء إلى حفظ صورة معدلة.",
  previewAlt: "الصورة المعدلة قبل الحفظ", previewHelp: "هذه هي الصورة التي ستُحفظ. يبقى العنوان والملاحظات وتفاصيل التوليد الأصلية دون تغيير. لم تخضع هذه المعاينة لمراجعة مستقلة.",
  save: "حفظ الصورة المعدلة", saving: "جارٍ حفظ الصورة المعدلة…", back: "العودة إلى التعديل", cancel: "إلغاء", done: "تم",
  check: "التحقق من عملية الحفظ هذه", checking: "جارٍ التحقق من عملية الحفظ هذه…",
  saved: "حُفظت الصورة المعدلة كمراجعة جديدة. لم تُعتمد.",
  unchanged: "لم تتغير بايتات الصورة. لم تُنشأ مراجعة جديدة.",
  unconfirmed: "لم تتأكد نتيجة الحفظ. لم يُرسل تحميل ثانٍ. تحقق من العملية الأصلية قبل بدء تعديل آخر.",
  pendingClose: "لا يؤدي الإغلاق إلى إلغاء عملية حفظ أُرسلت بالفعل.",
  unavailable: "تعذّر تحميل هذه الصورة أو إعدادها. أغلق المحرر وأعد فتح الناتج الحالي للمحاولة مرة أخرى.",
  invalid: "تعذّر إعداد معاينة هذا التركيب. أبقِ الصورة الأصلية في التركيب وتحقق من إعداداته.",
  source_changed: "تغيّر هذا الناتج. أعد فتح مراجعته الحالية قبل تعديله مجددًا.",
  forbidden: "لم يعد لديك إذن لتعديل هذه الصورة.",
};
const ja: GeneratedImageEditCopy = {
  action: "画像を編集", title: "この画像を編集", previewTitle: "編集した画像をプレビュー",
  help: "既存の画像参照で合成し、プレビューして保存します。元の画像は保持されます。この操作は画像の新規生成や出力の承認を行いません。",
  loading: "現在の画像を読み込み中…", preparing: "画像のプレビューを準備中…",
  adoption: "この画像を編集するには、まずこのドキュメントに参照として追加してください。このダイアログを開いただけではドキュメントは変更されません。",
  adopt: "コンテキストに追加して編集", adopting: "画像をコンテキストに追加中…",
  adoptionRemains: "コンテキストに追加した画像は、編集をキャンセルしてもドキュメントに残ります。キャンセルでは編集した画像は保存されません。",
  previewAlt: "保存前の編集した画像", previewHelp: "この画像が保存されます。元のタイトル、メモ、生成情報は変更されません。このプレビューは独立したレビューを受けていません。",
  save: "編集した画像を保存", saving: "編集した画像を保存中…", back: "編集に戻る", cancel: "キャンセル", done: "完了",
  check: "この保存結果を確認", checking: "この保存結果を確認中…",
  saved: "編集した画像を新しいリビジョンとして保存しました。承認はされていません。",
  unchanged: "画像のバイト列は変更されていません。新しいリビジョンは作成されませんでした。",
  unconfirmed: "保存結果は未確認です。再アップロードは行っていません。別の編集を始める前に元の操作を確認してください。",
  pendingClose: "閉じても、すでに送信された保存は取り消されません。",
  unavailable: "画像を読み込むか準備することができませんでした。エディターを閉じ、現在の出力を開き直してください。",
  invalid: "この合成のプレビューを準備できませんでした。元の画像を合成に残し、設定を確認してください。",
  source_changed: "この出力は変更されました。再編集する前に現在のリビジョンを開き直してください。",
  forbidden: "この画像を編集する権限がなくなりました。",
};
export const GENERATED_IMAGE_EDIT_MESSAGES: Readonly<Record<"en" | "fr" | "ar" | "ja", GeneratedImageEditCopy>> = { en, fr, ar, ja };
export function generatedImageEditCopy(locale: string): GeneratedImageEditCopy {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === "fr" ? fr : language === "ar" ? ar : language === "ja" ? ja : en;
}
export function generatedImageEditMessage(locale: string, key: keyof GeneratedImageEditCopy): string {
  return generatedImageEditCopy(locale)[key];
}
