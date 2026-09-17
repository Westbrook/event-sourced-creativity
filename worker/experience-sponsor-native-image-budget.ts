import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const encoder = new TextEncoder();
function fail(code: string): never { throw new SponsorEntitlementError(code); }

/** A single already-reserved HTTP attempt pays for retained DB reads, R2 reads
 * and response bytes. No operation refunds or renews its absolute deadline. */
export class SponsorNativeImageReadBudget {
  private used = 0;
  readonly maximumBytes: number;
  readonly monotonicDeadline: number;
  readonly signal: AbortSignal;
  constructor(maximumBytes: number, monotonicDeadline: number, signal: AbortSignal) {
    this.maximumBytes = maximumBytes; this.monotonicDeadline = monotonicDeadline; this.signal = signal;
  }
  check() {
    if (this.signal.aborted || performance.now() >= this.monotonicDeadline) fail("sponsor_read_deadline");
  }
  expect(bytes: number) {
    this.check();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > this.maximumBytes) fail("sponsor_read_byte_capacity");
  }
  spend(bytes: number) { this.expect(bytes); this.used += bytes; }
  account(value: unknown) { this.spend(encoder.encode(JSON.stringify(value)).byteLength); }
  async wait<T>(work: Promise<T>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const value = await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(new SponsorEntitlementError("sponsor_read_deadline"));
        timer = setTimeout(abort, Math.max(1, this.monotonicDeadline - performance.now()));
        this.signal.addEventListener("abort", abort, { once: true });
        if (this.signal.aborted) abort();
      })]);
      this.check(); return value;
    } finally { clearTimeout(timer); if (abort) this.signal.removeEventListener("abort", abort); }
  }
}

/** Closed adapter for the actual native Image reader. Known maximum result
 * sizes are reserved before dispatch, then only the actual transferred JSON
 * bytes are counted. Unknown SQL cannot silently receive a zero-byte budget. */
export function sponsorNativeImageReadEnvironment(env: WorkerEnv, budget: SponsorNativeImageReadBudget): WorkerEnv {
  type Captured = { original: D1PreparedStatement; maximumBytes: number };
  const statements = new WeakMap<D1PreparedStatement, Captured>();
  const classify = (sql: string): Captured => {
    let maximumBytes: number;
    if (sql.includes("page AS MATERIALIZED") && sql.includes("used<=512000")) maximumBytes = 3_200_000;
    else if (sql.includes("AS count,COALESCE(MAX(sequence),0) AS head")) {
      maximumBytes = 4_096;
      sql = sql.replace("COALESCE(MAX(sequence),0) AS head", "CASE WHEN typeof(COALESCE(MAX(sequence),0))='integer' THEN COALESCE(MAX(sequence),0) END AS head");
    } else if (sql.includes("AS revision_id,length(CAST(content_json AS BLOB)) AS body_bytes")) maximumBytes = 524_288;
    else if (sql.includes("AS witness FROM artifact_revisions")) {
      maximumBytes = 4_800_000;
      sql += " AND typeof(revision)='integer' AND revision>=0";
    } else if (sql.startsWith("SELECT CASE WHEN (") && sql.endsWith(" END AS current")) maximumBytes = 1_024;
    else if (sql.startsWith("SELECT instance_nonce,generation AS epoch,")) {
      maximumBytes = 4_096;
      sql = sql.replace("SELECT instance_nonce,generation AS epoch,",
        "SELECT CASE WHEN typeof(instance_nonce)='text' AND length(CAST(instance_nonce AS BLOB))=32 THEN instance_nonce END AS instance_nonce,CASE WHEN typeof(generation)='integer' THEN generation END AS epoch,")
        .replace("SELECT generation FROM scene_source_generations", "SELECT CASE WHEN typeof(generation)='integer' THEN generation ELSE 'invalid' END FROM scene_source_generations") + " LIMIT 2";
    }
    else if (sql === "SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>?") {
      maximumBytes = 6_400_000;
      sql += " AND typeof(content)='text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND 1048576 AND typeof(expires_at)='text' AND length(CAST(expires_at AS BLOB))<=40";
    } else return fail("sponsor_read_native_query_unbounded");
    return { original: env.DB.prepare(sql), maximumBytes };
  };
  const execute = async <T>(maximumBytes: number, work: () => Promise<T>) => {
    budget.expect(maximumBytes);
    const result = await budget.wait(work()); budget.account(result); return result;
  };
  const wrap = (captured: Captured): D1PreparedStatement => {
    const statement = {
      bind(...values: unknown[]) { return wrap({ ...captured, original: captured.original.bind(...values) }); },
      first<T>() { return execute(captured.maximumBytes, () => captured.original.first<T>()); },
    } as D1PreparedStatement;
    statements.set(statement, captured); return statement;
  };
  const DB = {
    prepare(sql: string) { budget.check(); return wrap(classify(sql)); },
    async batch<T>(items: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const captured = items.map(item => statements.get(item) ?? fail("sponsor_read_native_query_unbounded"));
      return execute(captured.reduce((sum, item) => sum + item.maximumBytes, 1_024), () => env.DB.batch<T>(captured.map(item => item.original)));
    },
  } as WorkerEnv["DB"];
  return { ...env, DB };
}

/** Verified bytes stay private until native final proofs pass. The response
 * itself remains bounded on every pull, including delayed/abandoned consumers. */
export function sponsorImageResponseBody(bytes: Uint8Array, budget: SponsorNativeImageReadBudget) {
  budget.spend(bytes.byteLength);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        budget.check();
        if (offset === bytes.byteLength) { bytes.fill(0); controller.close(); return; }
        const end = Math.min(bytes.byteLength, offset + 65_536);
        controller.enqueue(bytes.slice(offset, end)); offset = end;
      } catch (error) { bytes.fill(0); controller.error(error); }
    },
    cancel() { bytes.fill(0); },
  }, { highWaterMark: 0 });
}
