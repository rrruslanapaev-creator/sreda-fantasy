const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const handlerSource=fs.readFileSync(path.join(__dirname,'..','api','handler.js'),'utf8');
const appSource=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const pepper='integration-test-pepper-must-be-more-than-32-characters';
const salt='0123456789abcdef0123456789abcdef';
const existingPin='654321';
const existingHash=salt+':'+crypto.scryptSync(existingPin+pepper,salt,64).toString('hex');

function makeFixture(isPreview=false){
 const managers=[{id:'11111111-1111-1111-1111-111111111111',username:'Старый менеджер',
   username_normalized:'старый менеджер',pin_hash:existingHash,is_admin:false}];
 const sessions=[];
 const rpcCalls=[];
 const fakeClient={
  from(table){
   if(table==='managers')return {
    select(){return this;},eq(field,value){this.field=field;this.value=value;return this;},
    async maybeSingle(){return {data:managers.find(m=>m[this.field]===this.value)||null,error:null};},
    insert(payload){
     const duplicate=managers.some(x=>x.username_normalized===payload.username.toLowerCase());
     const m=duplicate?null:{id:'99999999-9999-9999-9999-'+String(managers.length).padStart(12,'0'),
       username:payload.username,username_normalized:payload.username.toLowerCase(),
       pin_hash:payload.pin_hash,is_admin:false};
     if(m)managers.push(m);
     return {select(){return this;},async single(){return duplicate?
       {data:null,error:{code:'23505'}}:{data:m,error:null};}};
    }
   };
   if(table==='manager_sessions')return {
    select(){return this;},eq(field,value){this.field=field;this.value=value;return this;},
    async maybeSingle(){return {data:sessions.find(x=>x[this.field]===this.value)||null,error:null};},
    insert(payload){sessions.push({...payload,revoked_at:null});return Promise.resolve({error:null});},
    update(patch){return {eq(field,value){const found=sessions.find(x=>x[field]===value);
      if(found)Object.assign(found,patch);return Promise.resolve({error:null});}};}
   };
   throw Error('Unexpected DB access: '+table);
  },
  async rpc(name,args){rpcCalls.push({name,args});
   if(name==='consume_rate_limit')return {data:true,error:null};
   if(name==='save_fantasy_roster')return {data:1,error:null};
   throw Error('Unexpected RPC: '+name);
  }
 };
 const sandbox={module:{exports:{}},exports:{},require:name=>{
  if(name==='@supabase/supabase-js')return {createClient:()=>fakeClient};
  if(name==='./season')return require('../api/season');
  if(name==='./results')return require('../api/results');
  return require(name);
 },process:{env:{SUPABASE_URL:'https://mock.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'mock',
   AUTH_PEPPER:pepper,VERCEL:'1',VERCEL_ENV:isPreview?'preview':'production'}},
 console,Buffer,Date,URL};
 vm.runInNewContext(handlerSource,sandbox,{filename:'api/handler.js'});
 const handler=sandbox.module.exports;
 async function request(action,payload={},cookie=''){
  const headers={origin:'https://sreda-fantasy.vercel.app',host:'sreda-fantasy.vercel.app',cookie};
  const req={method:'POST',headers,body:{action,...payload}};
  const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},
   status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  await handler(req,res);
  return res;
 }
 return {request,managers,sessions,rpcCalls};
}

test('Old username and PIN work unchanged; login never rewrites the stored PIN hash',async()=>{
 const f=makeFixture();
 const r=await f.request('login',{username:'Старый менеджер',pin:existingPin});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.user.username,'Старый менеджер');
 assert.equal(f.managers[0].pin_hash,existingHash);
 assert.equal(f.managers.length,1);
 assert.equal(f.sessions.length,1);
 assert.match(r.headers['set-cookie'],/^sf_session=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax/);
 assert.match(r.headers['set-cookie'],/Secure/);
 const token=r.headers['set-cookie'].match(/^sf_session=([a-f0-9]+)/)[1];
 assert.equal(f.sessions[0].token_hash,crypto.createHash('sha256').update(token).digest('hex'));
});

test('Wrong PIN is rejected without creating a session',async()=>{
 const f=makeFixture();
 const r=await f.request('login',{username:'Старый менеджер',pin:'000000'});
 assert.equal(r.statusCode,401);
 assert.equal(f.sessions.length,0);
 assert.equal(f.managers[0].pin_hash,existingHash);
});

test('Existing login session authorizes normal roster saves and logout revokes the cookie',async()=>{
 const f=makeFixture();
 const login=await f.request('login',{username:'Старый менеджер',pin:existingPin});
 const cookie=login.headers['set-cookie'].split(';')[0];
 const roster=Array.from({length:8},(_,i)=>({player_id:i+1,slot:i?'starter':'goalkeeper'}));
 const result=await f.request('save',{roster},cookie);
 assert.equal(result.statusCode,200);
 assert.equal(f.rpcCalls.filter(c=>c.name==='save_fantasy_roster').length,1);
 const logout=await f.request('logout',{},cookie);
 assert.equal(logout.statusCode,200);
 assert.ok(f.sessions[0].revoked_at);
 const rejected=await f.request('save',{roster},cookie);
 assert.equal(rejected.statusCode,401);
});

test('Registration and login with a new PIN work without changing old credentials',async()=>{
 const f=makeFixture();
 const registered=await f.request('register',{username:'Тестовый новый',pin:'987654'});
 assert.equal(registered.statusCode,200);
 assert.equal(f.managers.length,2);
 assert.equal(f.managers[0].pin_hash,existingHash);
 const login=await f.request('login',{username:'Тестовый новый',pin:'987654'});
 assert.equal(login.statusCode,200);
 const duplicate=await f.request('register',{username:'Тестовый новый',pin:'987654'});
 assert.equal(duplicate.statusCode,409);
});

test('Preview deployments prohibit all POST writes to the real project',async()=>{
 const f=makeFixture(true);
 const login=await f.request('login',{username:'Старый менеджер',pin:existingPin});
 const registration=await f.request('register',{username:'Тестовый новый',pin:'987654'});
 assert.equal(login.statusCode,403);
 assert.equal(registration.statusCode,403);
 assert.equal(f.sessions.length,0);
 assert.equal(f.managers.length,1);
});

test('Client exposes real username/PIN interface and only disables it in demo preview',()=>{
 const i=appSource.indexOf('function openLogin(){'),j=appSource.indexOf('async function submitAuth(',i);
 assert.ok(i>=0&&j>i);
 const auth=appSource.slice(i,j);
 for(const part of ['id="auth-form"','id="username"','id="pin"','type="password"',
  'autocomplete="username"','value="login"','value="register"','data-action="close"']){
  assert.ok(auth.includes(part),part);
 }
 assert.match(auth,/const demo=Boolean\(data\?\.previewMode\)/);
 assert.match(appSource,/const action=submitter\?\.value==='register'\?'register':'login'/);
 assert.match(appSource,/await api\(action,\{username,pin\}\)/);
});

test('Boosts remain disabled and cannot be activated through save API',async()=>{
 const f=makeFixture();
 const login=await f.request('login',{username:'Старый менеджер',pin:existingPin});
 const cookie=login.headers['set-cookie'].split(';')[0];
 const roster=Array.from({length:8},(_,i)=>({player_id:i+1,slot:i?'starter':'goalkeeper'}));
 const result=await f.request('save',{roster,boost:'wildcard'},cookie);
 assert.equal(result.statusCode,400);
 assert.equal(f.rpcCalls.filter(c=>c.name==='save_fantasy_roster').length,0);
});
