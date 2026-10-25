// Supabase stores its own session tokens through these standard Storage objects.
// This module stores only a mode and random tab identifier; never a password.
type Store = Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type SessionStorageChoice = {remember:boolean;storage:Store;storageKey:string};
export function createSessionPreferences(baseKey:string,local:()=>Store,session:()=>Store,uuid:()=>string) {
  const modeKey=baseKey+":persistence",tabKey=baseKey+":tab";
  function checked(getStore:()=>Store) {
    try {const storage=getStore(),probe=baseKey+":probe";storage.setItem(probe,"1");storage.removeItem(probe);return storage;}
    catch {throw new Error("Browser storage is unavailable. Allow site storage, then try signing in again.");}
  }
  function choice(remember:boolean):SessionStorageChoice {
    const tab=checked(session);
    let id=tab.getItem(tabKey);
    if(!id){id=uuid();tab.setItem(tabKey,id);}
    return {remember,storage:remember?checked(local):tab,storageKey:remember?baseKey:`${baseKey}-tab-${id}`};
  }
  function initial() {
    const tab=checked(session),mode=tab.getItem(modeKey);
    // Preserve sessions already saved by the deployed app. New sign-ins require
    // an explicit checkbox choice; a session-only tab never adopts another login.
    let legacy=false;try{legacy=!!local().getItem(baseKey);}catch{/* no persistent session accessible */}
    return choice(mode==="remember" || (mode!=="session"&&legacy));
  }
  function select(remember:boolean) {
    const next=choice(remember),tab=checked(session);
    // Remove only this app's inactive auth storage, including SDK auxiliary keys.
    const inactive=remember?tab:checked(local);
    const inactiveKey=remember?`${baseKey}-tab-${tab.getItem(tabKey)}`:baseKey;
    for(const suffix of ["","-user","-code-verifier"])inactive.removeItem(inactiveKey+suffix);
    tab.setItem(modeKey,remember?"remember":"session");
    return next;
  }
  return {initial,select,prepare:choice};
}

// Retired SDK requests may complete after dispose(). Ignore their late writes so
// a refresh cannot recreate a remembered token after opting for tab-only login.
export function retirableStorage(store:Store) {
  let active=true;
  return {retire:()=>{active=false;},storage:{
    getItem:(key:string)=>active?store.getItem(key):null,
    setItem:(key:string,value:string)=>{if(active)store.setItem(key,value);},
    removeItem:(key:string)=>{if(active)store.removeItem(key);},
  }};
}
