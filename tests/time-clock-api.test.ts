import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerTimeClock } from "../server/crm/time-clock";
process.env.SUPABASE_URL = "https://clock-test.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "local-test-only";
const nativeFetch = globalThis.fetch;
const employee = "11111111-1111-4111-8111-111111111111";
const coworker = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
let role = "technician", permission = true, entryOwner = employee;
let rpcBody: any;
let tableRequests = 0;
const app = express(); app.use(express.json()); registerTimeClock(app);
let server: ReturnType<typeof app.listen>, base: string;
globalThis.fetch = async (input: any, init?: any) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  assert.equal(url.hostname, "clock-test.supabase.invalid", "Only mocked Supabase calls permitted");
  const reply = (data: any, headers = {}) => new Response(JSON.stringify(data), { status:200, headers:{"content-type":"application/json", ...headers} });
  if (url.pathname === "/auth/v1/user") return reply({id:employee,aud:"authenticated"});
  if (url.pathname === "/rest/v1/profiles") {
    const select = url.searchParams.get("select");
    if (select === "id,full_name,role") { assert.equal(url.searchParams.get("company_id"),"eq.airking"); return reply([{id:employee,full_name:"Test",role}]); }
    return reply({id:employee,company_id:"airking",role,full_name:"Test",permissions:{time_clock:permission}});
  }
  if (url.pathname === "/rest/v1/rpc/time_clock_write") { rpcBody=JSON.parse(init.body); return reply({id:entryId}); }
  assert.equal(url.searchParams.get("company_id"), "eq.airking");
  tableRequests++;
  if (url.pathname === "/rest/v1/employee_time_entries") {
    if (url.searchParams.get("select") === "employee_id") return reply({employee_id:entryOwner});
    if (url.searchParams.has("clock_out")) { assert.equal(url.searchParams.get("employee_id"),`eq.${employee}`); return reply(null); }
    if(role === "technician") assert.equal(url.searchParams.get("employee_id"),`eq.${employee}`);
    return reply([], {"content-range":"0-0/0"});
  }
  if (url.pathname === "/rest/v1/employee_time_events") return reply([]);
  throw new Error("Unexpected test request");
};
before(async () => {
  server = app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve => server.on("listening",resolve));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { globalThis.fetch=nativeFetch; await new Promise<void>(resolve=>server.close(()=>resolve())); });
async function get(path: string, auth=true) {return nativeFetch(base+path,{headers:auth?{Authorization:"Bearer test"}:{}});}
const query = "/api/time-clock?from=2026-09-14&to=2026-09-20";
test("time APIs reject anonymous requests and disabled users", async () => {
  assert.equal((await get(query,false)).status,401);
  permission=false;
  try { assert.equal((await get(query)).status,403); } finally { permission=true; }
});
test("employee listing is self scoped and cannot request all or coworker hours",async()=>{
  const r=await get(query); assert.equal(r.status,200); const body:any=await r.json();
  assert.equal(body.manager,false);assert.equal(body.people.length,1);assert.equal(body.people[0].id,employee);
  assert.equal(r.headers.get("cache-control"),"no-store");
  const before=tableRequests;
  assert.equal((await get(query+"&employee=all")).status,403);
  assert.equal((await get(query+"&employee="+coworker)).status,403);
  assert.equal(tableRequests,before);
});
test("owner team listing stays company scoped, and date limits fail clearly",async()=>{
  role="owner";
  try { assert.equal((await get(query+"&employee=all")).status,200); } finally {role="technician";}
  assert.equal((await get("/api/time-clock?from=2026-01-01&to=2026-02-01")).status,400);
  assert.equal((await get("/api/time-clock?from=2026-02-01&to=2026-02-30")).status,400);
});
test("employees cannot retrieve a coworker's history",async()=>{
  entryOwner=coworker;
  try {assert.equal((await get(`/api/time-clock/${entryId}/history`)).status,404);} finally {entryOwner=employee;}
  assert.equal((await get(`/api/time-clock/${entryId}/history`)).status,200);
});
test("mutations use verified actor and reject clock-in timestamp or employee overrides",async()=>{
  const key=crypto.randomUUID();
  const send=(body:any)=>nativeFetch(base+"/api/time-clock",{method:"POST",headers:{Authorization:"Bearer test","content-type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)});
  assert.equal((await send({action:"clock_in"})).status,200);
  assert.deepEqual(rpcBody,{p_actor:employee,p_action:"clock_in",p_request:key,p_data:{}});
  assert.equal((await send({action:"clock_in",employee_id:coworker})).status,400);
  assert.equal((await send({action:"clock_in",clock_in:"2026-01-01T00:00:00Z"})).status,400);
});
