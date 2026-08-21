const ICONS: Readonly<Record<string, string>> = {
  spark: "✦", search: "⌕", undo: "↶", redo: "↷", share: "↗", lock: "⌁", unlock: "⌁", dots: "⠿", plus: "+", close: "×", play: "▶", pause: "Ⅱ", step: "↦", download: "⇩", compare: "◫", pin: "⌖", check: "✓", branch: "⌘", info: "i", replay: "↻", folder: "▱", clock: "◷", admin: "⌬", arrow: "→", eye: "◉", edit: "✎", trash: "⌫", image: "▧", menu: "☰", layers: "▤", user: "◉", story: "¶", video: "▷", warning: "△",
};

/** Pure visual vocabulary shared by design-system atoms and application organisms. */
export const icon = (name: string) => ICONS[name] ?? "•";
