import {test} from "node:test";
import assert from "node:assert/strict";
import { documentNumber } from "../shared/document-number";
import { publicFields } from "../server/crm/core";
import { nativeIntentParams } from "../server/crm/card-fee";
test("display uses stored number, preserving historical references as fallback",()=>{
 assert.equal(documentNumber({id:"INV-old"}),"INV-old");
 assert.equal(documentNumber({id:"INV-hex",documentNumber:"004425"}),"004425");
 for(const kind of ["invoice","quote"]){
  const data={id:"internal-id",documentNumber:"004425",items:[],options:[]};
  assert.equal(publicFields(kind,data).number,"004425");
  assert.equal(publicFields(kind,{...data,documentNumber:undefined}).number,"internal-id");
 }
});
test("provider label changes without changing payment metadata",()=>{
 const params=nativeIntentParams({id:"attempt",invoice_id:"INV-internal",amount_cents:1000,fee_cents:0},"004425");
 assert.equal(params.description,"Air King invoice 004425");
 assert.equal(params.metadata?.invoice_id,"INV-internal");
});
