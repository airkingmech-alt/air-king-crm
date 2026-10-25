// Real Supabase browser SDK against synthetic fetch responses only; no production auth.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';import {createServer} from 'vite';import react from '@vitejs/plugin-react';import WebSocket from 'ws';
const root=process.cwd(),fixture=await mkdtemp(path.join(root,'client/.remember-qa-')),profile=await mkdtemp(path.join(tmpdir(),'remember-chrome-'));
let vite,chrome;const sockets=[];
try {
 await writeFile(path.join(fixture,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script>');
 await writeFile(path.join(fixture,'logo.tsx'),'export function AirKingLogo(){return <span>Air King Mechanical</span>}');
 await writeFile(path.join(fixture,'main.tsx'),`
 import React from 'react';import{createRoot}from'react-dom/client';import '@/index.css';
 window.__qa={boot:crypto.randomUUID(),passwordCalls:0,refreshCalls:0,logoutCalls:0,invalid:false,revoke:false};
 const nativeFetch=window.fetch;
 window.fetch=async(input,init={})=>{
  const u=new URL(typeof input==='string'?input:input.url||String(input),location.href);
  if(u.origin===location.origin)return nativeFetch(input,init);
  if(u.hostname!=='remember-test.supabase.invalid')throw Error('External request prohibited');
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',email:'synthetic@example.invalid'};
  if(u.pathname==='/auth/v1/token'){
   const refresh=u.searchParams.get('grant_type')==='refresh_token';if(refresh)window.__qa.refreshCalls++;else window.__qa.passwordCalls++;
   await new Promise(r=>setTimeout(r,120));
   if(window.__qa.invalid||refresh&&window.__qa.revoke)return json({code:'invalid_grant',msg:'Synthetic sign-in rejected'},400);
   const exp=Math.floor(Date.now()/1000)+3600;
   return json({access_token:btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:user.id,aud:'authenticated',exp}))+'.synthetic',refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user});
  }
  if(u.pathname==='/auth/v1/logout'){window.__qa.logoutCalls++;return json({});}
  if(u.pathname==='/auth/v1/user')return json(user);
  if(u.pathname==='/rest/v1/profiles')return json({id:user.id,company_id:'synthetic-company',role:'owner',permissions:{},full_name:'Synthetic staff'});
  throw Error('Unexpected synthetic endpoint '+u.pathname);
 };
 async function boot(){
  const {AuthProvider,useAuth}=await import('@/context/auth-context');const {default:Login}=await import('@/pages/login');
  function Harness(){const auth=useAuth();window.__auth=auth;
   return auth.loading?<p>Loading session</p>:auth.session?<main><p>Signed in as synthetic staff</p><button onClick={()=>auth.signOut()}>Sign out</button></main>:<Login/>;}
  createRoot(document.getElementById('root')).render(<AuthProvider><Harness/></AuthProvider>);
 }boot();
 `);
 vite=await createServer({configFile:false,root:path.join(root,'client'),plugins:[react()],optimizeDeps:{entries:[path.join(fixture,'index.html')]},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://remember-test.supabase.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic-public-key')},resolve:{alias:[{find:'@/components/layout/app-shell',replacement:path.join(fixture,'logo.tsx')},{find:'@',replacement:path.join(root,'client/src')}]},server:{host:'127.0.0.1',port:5192,strictPort:true}});await vite.listen();
 const url=`http://127.0.0.1:5192/${path.basename(fixture)}/index.html`;
 async function launch(){
  chrome=spawn(process.env.CHROMIUM_PATH||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--remote-debugging-port=9342',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  for(let n=0;n<80;n++){try{const tabs=await(await fetch('http://127.0.0.1:9342/json')).json();return connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);}catch{await new Promise(r=>setTimeout(r,100));}}
  throw Error('Local Chromium unavailable');
 }
 async function connect(address){
  const ws=new WebSocket(address);sockets.push(ws);await new Promise(r=>ws.on('open',r));let id=0;const pending=new Map();
  ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,75));}throw Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
  return {send,evaluate,wait};
 }
 let page=await launch();
 const login=async(remember)=>{
  await page.wait("!!document.querySelector('#remember-me')");assert.equal(await page.evaluate("document.querySelector('#remember-me').checked"),false);
  await page.evaluate(`(()=>{for(const [id,value] of [['email','synthetic@example.invalid'],['password','synthetic-password']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}if(${remember})document.getElementById('remember-me').click();})()`);
  await page.evaluate("(()=>{const b=document.querySelector('[data-testid=button-submit-login]');b.click();b.click();})()");
 };
 const signed=()=>page.wait("document.body.innerText.includes('Signed in as synthetic staff')");
 const reload=async()=>{const previous=await page.evaluate('window.__qa.boot');await page.send('Page.reload');await page.wait(`window.__qa?.boot && window.__qa.boot!==${JSON.stringify(previous)}`);};
 const freshPage=async()=>{const t=await page.send('Target.createTarget',{url});const tabs=await(await fetch('http://127.0.0.1:9342/json')).json();return connect(tabs.find(x=>x.id===t.targetId).webSocketDebuggerUrl);};
 const restart=async()=>{const exiting=new Promise(r=>chrome.once('exit',r));await page.send('Browser.close').catch(()=>{});await exiting;page=await launch();await page.send('Page.navigate',{url});};
 await page.send('Page.navigate',{url});await login(false);await signed();
 assert.equal(await page.evaluate('window.__qa.passwordCalls'),1,'Repeated click makes one auth attempt');
 assert.equal(await page.evaluate("localStorage.getItem('sb-remember-test-auth-token')"),null);
 await reload();await signed();
 const second=await freshPage();await second.wait("!!document.querySelector('#remember-me')");
 assert.equal(await second.evaluate("document.body.innerText.includes('Signed in as synthetic staff')"),false,'A separate tab must not adopt session-only login via BroadcastChannel');
 await page.evaluate("window.__auth.signOut()");await page.wait("!!document.querySelector('#remember-me')");await reload();await page.wait("!!document.querySelector('#remember-me')");
 await login(true);await signed();assert.ok(await page.evaluate("!!localStorage.getItem('sb-remember-test-auth-token')"));
 assert.equal(await page.evaluate("JSON.stringify(localStorage).includes('synthetic-password')||JSON.stringify(sessionStorage).includes('synthetic-password')"),false);
 await reload();await signed();await restart();await signed();
 await page.evaluate("window.__auth.signOut()");await page.wait("!!document.querySelector('#remember-me')");assert.equal(await page.evaluate("localStorage.getItem('sb-remember-test-auth-token')"),null);
 await login(false);await signed();await restart();await page.wait("!!document.querySelector('#remember-me')");
 // Expiry/refresh still goes through SDK, and revoked refresh tokens cannot restore login.
 await login(false);await signed();
 await page.evaluate("(()=>{const key=Object.keys(sessionStorage).find(k=>k.includes('-tab-')&&!k.endsWith('-user'));const value=JSON.parse(sessionStorage.getItem(key));value.expires_at=1;sessionStorage.setItem(key,JSON.stringify(value));window.__qa.revoke=true;})()");
 await page.evaluate("import('/src/lib/supabase.ts').then(m=>m.supabase.auth.getSession())");
 await page.wait("!!document.querySelector('#remember-me')");assert.ok(await page.evaluate('window.__qa.refreshCalls>0'));
 await page.evaluate('window.__qa.invalid=true');await login(true);await page.wait("document.body.innerText.includes('Synthetic sign-in rejected')");assert.equal(await page.evaluate("!!localStorage.getItem('sb-remember-test-auth-token')"),false);
 await reload();await page.wait("!!document.querySelector('#remember-me')");
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await page.evaluate('document.documentElement.scrollWidth<=390'));
 assert.equal(await page.evaluate("document.querySelector('#remember-me').getAttribute('aria-describedby')"),'remember-help');
 await writeFile('/tmp/remember-me-mobile.png',Buffer.from((await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 console.log('PASS real Supabase SDK: unchecked/checked, refresh, clean browser restart, separate-tab isolation, logout, token revocation, invalid credentials, duplicate click, password-not-stored and mobile layout. Synthetic endpoints only.');
}finally{for(const ws of sockets)ws.close();chrome?.kill();await vite?.close();await rm(fixture,{recursive:true,force:true});await rm(profile,{recursive:true,force:true}).catch(()=>{});}
