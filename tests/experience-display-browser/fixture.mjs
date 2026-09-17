// Actual entry/view/catalog in a static browser. No Worker, private records,
// provider, persistence, generation, intake save or account authority exists.
import { definitions } from "../../src/experiences/catalog.ts";
import { registeredExperience } from "../../src/experiences/intake.ts";

const experiences = await Promise.all(definitions.map(definition => registeredExperience(definition.id)));
let reads = 0, forbidden = 0;
window.fetch = async (input, init) => {
  const request = new Request(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href), init);
  if (request.url === `${location.origin}/api/experiences/catalog` && request.method === "GET") {
    document.querySelector("#fixture-reads").textContent = `${++reads} catalog reads`;
    return Response.json({ version: 1, generation: "unavailable", experiences });
  }
  document.querySelector("#fixture-blocked").textContent = `${++forbidden} forbidden requests`;
  throw new Error("Local display fixture forbids all non-catalog requests");
};
await import("../../src/experiences/entry.ts");
