import { FormaExperienceSurface } from "../../../src/experiences/view.ts";
export class FormaExperienceFixture extends FormaExperienceSurface {}
if (!customElements.get("forma-experience-fixture")) customElements.define("forma-experience-fixture", FormaExperienceFixture);
