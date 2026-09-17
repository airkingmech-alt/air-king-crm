import { test } from "node:test";
import assert from "node:assert/strict";
import { contacts, destination, match, valueFor, matchesAudience } from "../server/crm/marketing-rules";

const customer:any={data:{name:"Taylor Test",contacts:[{role:"Billing",email:"wrong@example.com"},{role:"Primary",email:" Primary@Example.com ",phone:"(816) 555-1234"}],properties:[{city:"Lathrop",zip:"64465",systems:[{brand:"Champion",installDate:"2020-01-01"}]}]}};

test("campaign delivery uses the primary contact consistently",()=>{
  assert.equal(contacts(customer).email,"primary@example.com");
  assert.equal(destination(customer,"email"),"primary@example.com");
  assert.equal(destination(customer,"sms"),"+18165551234");
});

test("missing history and equipment do not behave like zero",()=>{
  assert.equal(valueFor("last_service_months",{data:{}},{jobs:[]}),null);
  assert.equal(valueFor("equipment_age",{data:{}},{}),null);
  assert.equal(match(null,{op:"lt",value:12}),false);
  assert.equal(match(undefined,{op:"neq",value:"Paid"}),false);
});

test("customer arrays and completed jobs support audience filters",()=>{
  assert.equal(match(valueFor("city",customer,{}),{op:"eq",value:"Lathrop"}),true);
  const months=valueFor("last_service_months",customer,{jobs:[{data:{status:"Completed",completedAt:"2026-01-01"}}]},Date.parse("2026-07-01"));
  assert.ok(Number(months)>5 && Number(months)<7);
});

test("age and refrigerant filters must match the same active equipment",()=>{
  const filters=[{field:"equipment_age",op:"gt",value:11},{field:"equipment_refrigerant",op:"eq",value:"R-22"},{field:"equipment_type",op:"eq",value:"AC"}];
  const profile=(systems:any[])=>({data:{properties:[{systems}]}});
  const old={type:"AC",manufactureYear:2000,refrigerant:"R-410A",status:"Active"};
  const newer={type:"AC",manufactureYear:new Date().getUTCFullYear(),refrigerant:"R22",status:"Active"};
  assert.equal(matchesAudience(profile([old,newer]),{},{filters}),false);
  assert.equal(matchesAudience(profile([{...old,refrigerant:"R 22"}]),{},{filters}),true);
  assert.equal(matchesAudience(profile([{...old,refrigerant:"R22",status:"Inactive"}]),{},{filters}),false);
  assert.equal(matchesAudience(profile([{type:"AC",refrigerant:"R22"}]),{},{filters}),false);
});
