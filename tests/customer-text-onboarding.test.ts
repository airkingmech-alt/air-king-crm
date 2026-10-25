import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesCustomerSearch} from '../shared/customer-search';
import {recordNewCustomerConsent} from '../shared/new-customer-consent';

test('customer text lookup matches names, formatted phones, secondary phones, email, address and record ID',()=>{
  const c={id:'cust-42',name:'Jordan Sample',companyName:'Sample HVAC',contacts:[{phone:'(816) 555-0105',email:'office@example.com',phoneNumbers:[{value:'+1 913 555 0123'}]}],properties:[{address:'123 Main St',city:'Lathrop',zip:'64465'}]};
  for(const q of ['','jordan','SAMPLE JORDAN','8165550105','(913) 555-0123','office@example','123 Main','lathrop','cust-42','Sample HVAC'])assert.equal(matchesCustomerSearch(c,q),true,q);
  assert.equal(matchesCustomerSearch(c,'unrelated'),false);
  assert.equal(matchesCustomerSearch({id:'missing'},'816'),false);
});
test('new-customer consent is opt-in and cannot turn on marketing or overwrite other preferences',async()=>{
  const calls:any[]=[];const request=async(...args:any[])=>{calls.push(args);};
  await recordNewCustomerConsent('c',false,request);await recordNewCustomerConsent('c',undefined,request);
  assert.equal(calls.length,0);
  assert.equal(await recordNewCustomerConsent('c',true,request),undefined);
  assert.deepEqual(calls,[['crm/customers/c/service-text-consent','POST',{confirmed:true}]]);
});
test('consent save uncertainty preserves the saved customer and gives an actionable warning rather than repeating creation',async()=>{
  let attempts=0;
  const warning=await recordNewCustomerConsent('saved',true,async()=>{attempts++;throw Error('Synthetic interrupted response');});
  assert.equal(attempts,1);assert.match(warning!,/Customer saved/);assert.match(warning!,/could not be confirmed/);
});
