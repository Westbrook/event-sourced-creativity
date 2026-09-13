/** Shell-only shortcuts; editable controls retain the browser's undo history. */
export type ExperienceShellShortcut = "commands" | "undo" | "redo" | "suppress" | "none";

export function experienceShellShortcut(
  restricted: boolean,
  key: string,
  modifier: boolean,
  editingField: boolean,
  shift: boolean,
): ExperienceShellShortcut {
  if (!modifier) return "none";
  const normalized = key.toLowerCase();
  if (normalized === "k") return restricted ? "suppress" : "commands";
  if (normalized === "z" && !editingField) return restricted ? "suppress" : shift ? "redo" : "undo";
  return "none";
}
