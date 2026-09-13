import type { OutputTrustedContext } from "./output-requirements-api.ts";
import type { OutputReadModel } from "./output-requirements-read-model.ts";

const outputReadModels = new WeakMap<OutputTrustedContext, Promise<OutputReadModel>>();

export { outputReadModels };
