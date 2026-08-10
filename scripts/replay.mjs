import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { foldEvents } from "../src/model/events.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const source = args.get("--file");
if (!source) {
  console.error("Usage: pnpm replay --file <archive.json> [--as-of <sequence>] [--projection context-document]");
  process.exitCode = 1;
} else {
  const input = JSON.parse(await readFile(resolve(source), "utf8"));
  const events = Array.isArray(input) ? input : input.events;
  if (!Array.isArray(events)) throw new Error("Fixture must be an event array or an object with an events array");
  const asOf = Number(args.get("--as-of") ?? Number.POSITIVE_INFINITY);
  const projection = foldEvents(events, asOf);
  process.stdout.write(`${JSON.stringify({ projection: args.get("--projection") ?? "context-document", asOf, rows: projection }, (_key, value) => value instanceof Set ? [...value] : value, 2)}\n`);
}
