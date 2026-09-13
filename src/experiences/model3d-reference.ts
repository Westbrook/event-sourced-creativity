/** Authored selection and permission statement, never backend ownership evidence. */
export type Model3dReferenceIntent = Readonly<{
  version: 1;
  kind: "image" | "saved-model-view";
  sourceProjectId: string;
  sourceDocumentId: string;
  sourceBlockId: string;
  referenceId: string;
  sha256: string;
  permissionAttestation: "i-own-or-have-permission";
}>;

const fields = ["version", "kind", "sourceProjectId", "sourceDocumentId", "sourceBlockId", "referenceId", "sha256", "permissionAttestation"] as const;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,239}$/u.test(value);

/** One retained source only. URLs, files, owner claims and inferred permission are not inputs. */
export function readModel3dReferenceIntent(value: unknown): Model3dReferenceIntent | null {
  try {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== fields.length || !fields.every(key => Object.hasOwn(descriptors, key))) return null;
    const copy: Record<string, unknown> = {};
    for (const key of fields) {
      const field = descriptors[key]!;
      if (!Object.hasOwn(field, "value") || !field.enumerable) return null;
      copy[key] = field.value;
    }
    if (copy.version !== 1 || !["image", "saved-model-view"].includes(copy.kind as string)
      || copy.permissionAttestation !== "i-own-or-have-permission"
      || !["sourceProjectId", "sourceDocumentId", "sourceBlockId", "referenceId"].every(key => id(copy[key]))
      || typeof copy.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(copy.sha256)) return null;
    return Object.freeze(copy) as Model3dReferenceIntent;
  } catch { return null; }
}
