import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionPreferences,retirableStorage} from '../client/src/lib/session-persistence';
class Store {values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}removeItem(k:string){this.values.delete(k);}}
const base='sb-synthetic-auth-token';
const make=(local=new Store(),tab=new Store(),id='tab-one')=>({local,tab,prefs:createSessionPreferences(base,()=>local,()=>tab,()=>id)});
test('new logins default to tab-only storage, refresh restores it, and a fresh tab cannot adopt it',()=>{
 const a=make();const choice=a.prefs.initial();assert.equal(choice.remember,false);choice.storage.setItem(choice.storageKey,'synthetic-session');
 assert.equal(make(a.local,a.tab).prefs.initial().storage.getItem(choice.storageKey),'synthetic-session');
 const fresh=make(a.local,new Store(),'tab-two').prefs.initial();assert.notEqual(fresh.storageKey,choice.storageKey);assert.equal(fresh.storage.getItem(fresh.storageKey),null);assert.equal(a.local.values.size,0);
});
test('explicit remember stores with the legacy SDK key and survives a fresh browser session',()=>{
 const a=make(),choice=a.prefs.select(true);choice.storage.setItem(choice.storageKey,'synthetic-session');
 assert.equal(choice.storageKey,base);const fresh=make(a.local,new Store(),'next').prefs.initial();assert.equal(fresh.remember,true);assert.equal(fresh.storage.getItem(base),'synthetic-session');
});
test('existing persistent sessions remain compatible but explicitly session-only tabs do not adopt them',()=>{
 const a=make();a.local.setItem(base,'legacy-session');assert.equal(a.prefs.initial().remember,true);
 a.prefs.select(false);a.local.setItem(base,'another-tab-login');assert.equal(a.prefs.initial().remember,false);
});
test('changing choice removes only inactive app auth keys and retains unrelated browser preferences',()=>{
 const a=make();a.local.setItem('other-app','keep');a.tab.setItem('draft','keep');
 for(const suffix of ['','-user','-code-verifier'])a.local.setItem(base+suffix,'synthetic');
 const session=a.prefs.select(false);assert.equal(a.local.getItem(base),null);assert.equal(a.local.getItem(base+'-user'),null);
 for(const suffix of ['','-user','-code-verifier'])session.storage.setItem(session.storageKey+suffix,'synthetic');
 a.prefs.select(true);assert.equal(a.tab.getItem(session.storageKey),null);assert.equal(a.tab.getItem('draft'),'keep');assert.equal(a.local.getItem('other-app'),'keep');
});
test('SDK removeItem logout clears the selected token without copying it to the other store',()=>{
 for(const remember of [false,true]){const a=make(),s=a.prefs.select(remember);s.storage.setItem(s.storageKey,'synthetic');s.storage.removeItem(s.storageKey);assert.equal(s.storage.getItem(s.storageKey),null);assert.equal(a.local.getItem(base),null);}
});
test('blocked browser storage fails explicitly rather than upgrading to persistent storage',()=>{
 const bad=()=>{throw Error('blocked');};assert.throws(()=>createSessionPreferences(base,bad,bad,()=> 'id').select(false),/storage is unavailable/);
 const a=make();assert.throws(()=>createSessionPreferences(base,bad,()=>a.tab,()=> 'id').select(true),/storage is unavailable/);assert.equal(a.tab.getItem(base),null);
});

test('late refresh writes from a retired SDK client cannot restore persistent tokens',()=>{
 const store=new Store(),old=retirableStorage(store);old.storage.setItem(base,'synthetic-old');
 old.retire();store.removeItem(base);old.storage.setItem(base,'synthetic-late-refresh');assert.equal(store.getItem(base),null);
 store.setItem(base,'synthetic-new-client');old.storage.removeItem(base);assert.equal(store.getItem(base),'synthetic-new-client');assert.equal(old.storage.getItem(base),null);
});
