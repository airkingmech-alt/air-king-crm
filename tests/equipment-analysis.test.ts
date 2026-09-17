import test from "node:test";
import assert from "node:assert/strict";
import { confirmedEquipment, analysisSchema } from "../shared/equipment-analysis";
import { analyzeNameplate } from "../server/crm/equipment-analysis";
test("AI unavailable never returns fabricated equipment",async()=>{
  const original=process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {await assert.rejects(analyzeNameplate("data:image/jpeg;base64,AAAA"),/not connected/);} finally {if(original)process.env.ANTHROPIC_API_KEY=original;}
});
test("equipment confirmation rejects invalid years and unknown types",()=>{
  const data={brand:"Champion",model:"",serial:"",type:"AC",capacity:"3 tons",efficiency:"",refrigerant:"R22",manufactureYear:2000,notes:""};
  assert.equal(confirmedEquipment.safeParse(data).success,true);
  assert.equal(confirmedEquipment.safeParse({...data,manufactureYear:3000}).success,false);
  assert.equal(confirmedEquipment.safeParse({...data,type:"Unknown"}).success,false);
  assert.equal(analysisSchema.safeParse({note:"looks old"}).success,false);
});
