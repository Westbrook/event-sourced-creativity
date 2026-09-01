import type { CommandDiscoveryCopy } from "../../../model/command-discovery.ts";

const messages:Record<"en"|"fr"|"ar"|"ja",CommandDiscoveryCopy>={
  en:{project:"Project",document:"Document",decision:"Decision",review:"Assigned review",saved:"Saved creative result",untitled:"Untitled",
    open:"Open {name}",prepare:"Prepare an output…",prepareFormat:"Prepare {format}",generateAlias:"Generate Create",
    reference:"ID",search:"Search work and actions",placeholder:"Search a name or action…",scope:"Current project and loaded work; your assigned reviews.",empty:"No matching loaded work or action.",
    unavailable:"This exact item changed or is no longer available. Search the current work again.",
    changed:"The selected result changed. Choose a current result.",chooseDocument:"Choose a document to prepare an output",preparing:"Settings only · nothing is generated"},
  fr:{project:"Projet",document:"Document",decision:"Décision",review:"Révision attribuée",saved:"Résultat créatif enregistré",untitled:"Sans titre",
    open:"Ouvrir {name}",prepare:"Préparer un résultat…",prepareFormat:"Préparer : {format}",generateAlias:"Générer Créer",
    reference:"ID",search:"Rechercher un travail ou une action",placeholder:"Rechercher un nom ou une action…",scope:"Projet actuel et travail chargé ; vos révisions attribuées.",empty:"Aucun travail chargé ni aucune action ne correspond.",
    unavailable:"Cet élément précis a changé ou n’est plus disponible. Relancez la recherche dans le travail actuel.",
    changed:"Le résultat sélectionné a changé. Choisissez un résultat actuel.",chooseDocument:"Choisir un document pour préparer un résultat",preparing:"Réglages uniquement · aucune génération"},
  ar:{project:"مشروع",document:"مستند",decision:"قرار",review:"مراجعة مسندة",saved:"نتيجة إبداعية محفوظة",untitled:"بلا عنوان",
    open:"فتح {name}",prepare:"إعداد نتيجة…",prepareFormat:"إعداد {format}",generateAlias:"توليد إنشاء",
    reference:"المعرّف",search:"البحث في العمل والإجراءات",placeholder:"ابحث عن اسم أو إجراء…",scope:"المشروع الحالي والعمل المحمّل؛ ومراجعاتك المسندة.",empty:"لا يوجد عمل محمّل أو إجراء مطابق.",
    unavailable:"تغيّر هذا العنصر المحدد أو لم يعد متاحًا. ابحث في العمل الحالي مجددًا.",
    changed:"تغيّرت النتيجة المحددة. اختر نتيجة حالية.",chooseDocument:"اختيار مستند لإعداد نتيجة",preparing:"الإعدادات فقط · لا يتم توليد شيء"},
  ja:{project:"プロジェクト",document:"ドキュメント",decision:"決定",review:"割り当てられたレビュー",saved:"保存済みの制作結果",untitled:"無題",
    open:"{name}を開く",prepare:"出力を準備…",prepareFormat:"{format}を準備",generateAlias:"生成 作成",
    reference:"ID",search:"作業と操作を検索",placeholder:"名前や操作を検索…",scope:"現在のプロジェクトと読み込み済みの作業、割り当てられたレビュー。",empty:"一致する読み込み済みの作業や操作はありません。",
    unavailable:"この項目は変更されたか、利用できなくなりました。現在の作業をもう一度検索してください。",
    changed:"選択した結果が変更されました。現在の結果を選び直してください。",chooseDocument:"出力を準備するドキュメントを選択",preparing:"設定のみ・生成は行いません"},
};
export function commandDiscoveryCopy(locale:string):CommandDiscoveryCopy{
  const family=locale.split("-")[0];return messages[family==="fr"||family==="ar"||family==="ja"?family:"en"];
}
