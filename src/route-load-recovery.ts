type RecoveryCopy = { title: string; help: string; reload: string };
export function routeLoadRecoveryCopy(locale: string): RecoveryCopy {
  switch (locale.toLowerCase().split(/[-_]/u)[0]) {
    case "fr": return { title: "Cette page n’a pas pu être chargée", help: "Forma a peut-être été mis à jour, ou la connexion a été interrompue. Copiez tout texte non enregistré avant d’actualiser. L’actualisation ne renvoie aucune demande de génération.", reload: "Actualiser cette page" };
    case "ar": return { title: "تعذّر تحميل هذه الصفحة", help: "ربما تم تحديث Forma أو انقطع الاتصال. انسخ أي نص غير محفوظ قبل تحديث الصفحة. لن يعيد التحديث إرسال طلب توليد.", reload: "تحديث هذه الصفحة" };
    case "ja": return { title: "このページを読み込めませんでした", help: "Forma が更新されたか、接続が中断された可能性があります。更新前に未保存のテキストをコピーしてください。ページの更新で生成リクエストが再送信されることはありません。", reload: "このページを更新" };
    default: return { title: "This page could not be loaded", help: "Forma may have updated, or the connection was interrupted. Copy any unsaved text before refreshing. Refreshing does not resubmit a generation request.", reload: "Refresh this page" };
  }
}

/** Independent of lazy route modules. Never silently reload or discard a draft. */
export function installRouteLoadRecovery(view: Window, owner: Document) {
  let notice: HTMLElement | null = null;
  const show = () => {
    if (notice?.isConnected) return;
    if (!owner.body) { owner.addEventListener("DOMContentLoaded", show, { once: true }); return; }
    const copy = routeLoadRecoveryCopy(owner.documentElement.lang || "en");
    notice = owner.createElement("section"); notice.className = "route-load-recovery";
    notice.setAttribute("role", "alert"); notice.setAttribute("aria-label", copy.title);
    notice.setAttribute("popover", "manual");
    const title = owner.createElement("strong"), help = owner.createElement("p"), reload = owner.createElement("button");
    title.textContent = copy.title; help.textContent = copy.help;
    reload.type = "button"; reload.className = "button"; reload.textContent = copy.reload;
    reload.addEventListener("click", () => view.location.reload());
    notice.append(title, help, reload); owner.body.append(notice);
    // The alert announces without moving focus. Older browsers retain the same
    // ordinary visible region; no modal, blanket inertness or focus trap.
    try { notice.showPopover?.(); } catch { notice.removeAttribute("popover"); }
  };
  view.addEventListener("vite:preloadError", show);
  return show;
}
