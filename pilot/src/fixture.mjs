// A only. Native domain behavior with a disposable test database, never a PG adapter.
import {createSceneCostFixture} from '../../tests/helpers/scene-cost-fixture.mjs';
export async function createVisualAdapter(){
 // This process cannot dispatch external provider/storage requests, even accidentally.
 globalThis.fetch=async()=>{throw Error('visual_fixture_external_network_disabled');};
 const f=await createSceneCostFixture(0);
 f.env.STILL_UNIFIED_CREATION_ENABLED='true';
 f.env.STILL_CREATION_INDEX_ENABLED='false';
 f.env.MEMORY_ENABLED='false';
 f.env.OPENAI_API_KEY='';f.env.JEV_API_KEY='';
 return {request:f.request,close:async()=>{await f.drainBackground();f.close();},description:{identity:'simulated dev-local-creative',persistence:'disposable in-memory SQLite',providers:'disabled; native manual/title-only fallback',projectId:f.projectId,documentId:f.documentId}};
}
