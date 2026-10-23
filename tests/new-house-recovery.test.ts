import {test} from "node:test";
import assert from "node:assert/strict";
import {readTakeoffRecovery,takeoffRecoveryKey} from "../client/src/lib/new-house-recovery";
test("takeoff recovery is isolated by user, company and original quote",()=>{
 const key=takeoffRecoveryKey("company","user");
 assert.notEqual(key,takeoffRecoveryKey("other","user"));assert.notEqual(key,takeoffRecoveryKey("company","other"));assert.notEqual(key,takeoffRecoveryKey("company","user","Q-1"));
 const draft={version:1,customerId:"c",propertyId:"p",state:{project:{projectName:"Unsaved"},crewDays:2}};
 const map=new Map([[key,JSON.stringify(draft)]]);const storage={getItem:(k:string)=>map.get(k)||null};
 assert.deepEqual(readTakeoffRecovery(storage,key),draft);assert.equal(readTakeoffRecovery(storage,takeoffRecoveryKey("other","user")),null);
});
test("missing, malformed and unavailable recovery storage fails closed",()=>{
 for(const raw of [null,"broken",JSON.stringify({version:2}),JSON.stringify({version:1,customerId:"c",propertyId:"p",state:[]})])assert.equal(readTakeoffRecovery({getItem:()=>raw},"x"),null);
 assert.equal(readTakeoffRecovery({getItem:()=>{throw Error("disabled")}},"x"),null);
});
