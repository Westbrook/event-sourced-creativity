import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Exercise the actual startup call expression without importing unrelated shell
// runtime. The genuine built browser continuation verifies component upgrading.
const source=readFileSync(new URL("../src/components/forma-shell.ts",import.meta.url),"utf8");
const connected=source.slice(source.indexOf("override connectedCallback()"),source.indexOf("override disconnectedCallback()"));
const expression=connected.match(/void loadRouteComponent\([^;]+\);/g);
assert.equal(expression?.length,1);
for(const route of ["/document/current/image?experience=image&experience-draft=experience-draft-"+"a".repeat(64),"/document/current/slides?experience=slides&experience-draft=experience-draft-"+"b".repeat(64)+"&progress-report#retained","/projects"]){
  test("shell startup forwards the complete authoritative route: "+route,()=>{
    const calls=[],location={pathname:new URL(route,"https://forma.test").pathname};
    const invoke=new Function("loadRouteComponent","location",expression[0]);
    invoke.call({store:{route:{get:()=>route}}},value=>calls.push(value),location);
    assert.deepEqual(calls,[route]);
  });
}
