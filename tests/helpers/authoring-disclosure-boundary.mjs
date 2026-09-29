import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
// Same native SQLite clock body as the existing consequentialDbClock fixture.
export function disclosureDbClock(state){
  const native=new DatabaseSync(":memory:");let now=new Date().toISOString();
  state.sqlite.function("strftime",{varargs:true},(...args)=>{const values=args.map((value,index)=>index===1&&value==="now"?now:value);return native.prepare("SELECT strftime("+values.map(()=>"?").join(",")+") AS value").get(...values).value;});
  return{set(value){now=value;},close(){native.close();}};
}
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
export const canonicalState = state => Object.fromEntries(["events", "event_private_payloads", "authoring_commits"]
  .map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
export const financialState = state => Object.fromEntries(["document_jobs", "budget_reservations", "cost_budget_reservations",
  "cost_budget_counters", "consequential_executions", "consequential_execution_steps"]
  .map(table => [table, state.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
export function disclosureBoundary(state, fault) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), evidence = { reached: 0, previewId: null };
  state.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.startsWith("SELECT saved.content_id AS retained_id,")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), first = bound.first.bind(bound);
      bound.first = async (...args) => {
        if (!evidence.reached) {
          evidence.reached++; evidence.previewId = values[0];
          const id = evidence.previewId, before = state.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);
          assert.ok(before?.content && before.redacted_at === null, "the final guard starts from an actual retained private review");
          if (fault === "erased") state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), id);
          if (fault === "redacted") state.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), id);
          if (fault === "missing") state.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(id);
          if (fault === "bytes") state.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(id);
          if (fault === "source") state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.binding.sourceHash','changed-retained-source') WHERE content_id=?").run(id);
          if (fault === "owner") state.sqlite.prepare("UPDATE private_content SET owner_id='defensive-other-owner' WHERE content_id=?").run(id);
          if (fault === "kind") state.sqlite.prepare("UPDATE private_content SET kind='defensive-other-kind' WHERE content_id=?").run(id);
          if (fault === "expiry") state.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(id);
          if (fault === "bad-json") state.sqlite.prepare("UPDATE private_content SET content='{' WHERE content_id=?").run(id);
          if (fault === "principal") state.sqlite.prepare("UPDATE users SET updated_at=updated_at||'-withdrawn' WHERE user_id=?")
            .run(state.headers["oai-authenticated-user-id"] ?? state.ownerId);
          if (fault === "custody") {
            if (state.projectAccessId) state.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id='defensive-other-actor' WHERE resource_kind='content' AND resource_id=?").run(id);
            else state.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'content',?,?,?,?, 'actor_private',NULL,?,?)")
              .run("defensive-other-access", id, "defensive-other-org", "project-atmosphere", state.ownerId, state.ownerId, new Date().toISOString());
          }
        }
        return first(...args);
      };
      return bound;
    };
    return statement;
  };
  return { evidence, restore() { state.env.DB.prepare = prepare; } };
}
export function pauseOperationLookup(state) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), entered = deferred(), release = deferred(); let held = false;
  state.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.startsWith("SELECT preview_id FROM")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), first = bound.first.bind(bound);
      bound.first = async (...args) => {
        const value = await first(...args);
        if (!held && !value) { held = true; entered.resolve(); await release.promise; }
        return value;
      };
      return bound;
    };
    return statement;
  };
  return { entered: entered.promise, release: release.resolve, restore() { state.env.DB.prepare = prepare; } };
}
export function pauseClaim(state) {
  const prepare = state.env.DB.prepare.bind(state.env.DB), entered = deferred(), release = deferred(); let held = false;
  state.env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','applying'")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values), run = bound.run.bind(bound);
      bound.run = async (...args) => {
        const value = await run(...args);
        if (!held && Number(value.meta.changes) === 1) { held = true; entered.resolve(); await release.promise; }
        return value;
      };
      return bound;
    };
    return statement;
  };
  return { entered: entered.promise, release: release.resolve, restore() { state.env.DB.prepare = prepare; } };
}
