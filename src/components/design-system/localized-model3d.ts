import type { Model3dValidationIssue } from "../../model/model3d.ts";
import type { FormaLocaleController, FormaMessageValues } from "./localization.ts";
import { FORMA_MODEL3D_MESSAGES } from "./locales/model3d-messages.ts";

type Model3dLocalization = Pick<FormaLocaleController, "t" | "number">;
const englishMessages: Readonly<Record<string, string>> = FORMA_MODEL3D_MESSAGES.en;

/** Present authored validation guidance without changing the retained provider contract. */
export function localizedModel3dValidationIssue(issue: Model3dValidationIssue, locale: Model3dLocalization) {
  const id = `model3d.validation.${issue.code}`;
  if (!Object.hasOwn(englishMessages, id)) {
    return locale.t("model3d.validation.unknown", "Review the 3D settings and selected references before generating.");
  }
  const values: FormaMessageValues = {};
  for (const [name, value] of Object.entries(issue.values ?? {})) {
    if (typeof value === "number") values[name] = locale.number(value);
    else if (name === "field") {
      const fieldId = `model3d.field.${value}`;
      values[name] = Object.hasOwn(englishMessages, fieldId) ? locale.t(fieldId, englishMessages[fieldId]) : value;
    } else values[name] = value;
  }
  return locale.t(id, englishMessages[id], values);
}
