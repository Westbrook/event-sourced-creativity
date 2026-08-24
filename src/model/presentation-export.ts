/** Every supported external presentation editor receives a genuine, editable OOXML PowerPoint file. */
export function presentationEditableExportFilename(title: string, locale = "en") {
  const basename = String(title).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").normalize("NFKC")
    .toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "slide-deck";
  return `${basename}.pptx`;
}
