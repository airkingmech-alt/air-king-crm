import { test } from "node:test";
import assert from "node:assert/strict";
import { contacts, destination, match, valueFor } from "../server/crm/marketing-rules";

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
