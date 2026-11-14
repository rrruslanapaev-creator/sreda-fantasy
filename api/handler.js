// Vercel Node serverless function. ALL Supabase database access stays on this server.
const {createClient}=require('@supabase/supabase-js');
const {createHash,randomBytes,scryptSync,timingSafeEqual}=require('node:crypto');
const scoring=require('./results');
const season=require('./season');

const SESSION_COOKIE='sf_session';
const sha=x=>createHash('sha256').update(x).digest('hex');
function db(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,pepper=process.env.AUTH_PEPPER;
  if(!url||!key||!pepper||pepper.length<32)throw Error('Missing server environment variables');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
function pinHash(pin){
  const salt=randomBytes(16).toString('hex');
  return salt+':'+scryptSync(pin+process.env.AUTH_PEPPER,salt,64).toString('hex');
}
function pinVerify(pin,stored){
  try{
    const [salt,hex]=stored.split(':');
    if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(hex))return false;
    return timingSafeEqual(Buffer.from(hex,'hex'),scryptSync(pin+process.env.AUTH_PEPPER,salt,64));
  }catch{return false;}
}
function getCookie(req,name){
  const cookie=req.headers.cookie||'';
  const entry=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));
  return entry?decodeURIComponent(entry.slice(name.length+1)):null;
}
function setCookie(res,token,age){
  res.setHeader('Set-Cookie',SESSION_COOKIE+'='+token+'; Path=/; Max-Age='+age+'; HttpOnly; SameSite=Lax'+(process.env.VERCEL?' ; Secure':''));
}
function send(res,status,data){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(data);
}
function error(res,error){
  console.error('Sreda server:',error?.message||error);
  return send(res,503,{error:'Ошибка сервера. Проверь переменные Vercel и SQL-миграцию Supabase.'});
}
function originValid(req){
  try{
    const u=new URL(req.headers.origin||'');
    const host=req.headers['x-forwarded-host']||req.headers.host;
    return !!host&&u.host===host&&['https:','http:'].includes(u.protocol);
  }catch{return false;}
}
async function currentUser(client,req){
  const token=getCookie(req,SESSION_COOKIE);
  if(!/^[0-9a-f]{64}$/.test(token||''))return null;
  const {data:s,error}=await client.from('manager_sessions')
    .select('manager_id,expires_at,revoked_at').eq('token_hash',sha(token)).maybeSingle();
  if(error||!s||s.revoked_at||Date.parse(s.expires_at)<=Date.now())return null;
  const {data:m}=await client.from('managers').select('id,username,is_admin').eq('id',s.manager_id).maybeSingle();
  return m||null;
}
async function throttle(client,req,scope,limit=8,seconds=900){
  // Two dimensions: remote IP and manager name. Never rely solely on a user-supplied name.
  const ip=String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'unknown').split(',')[0];
  const key=sha(ip+'|'+scope);
  const {data,error}=await client.rpc('consume_rate_limit',{p_key:key,p_max:limit,p_window_seconds:seconds});
  if(error)throw error;
  return data===true;
}
async function state(client,user){
  const [p,r,m,s]=await Promise.all([
    client.from('players').select('id,name,position,price,active').order('price',{ascending:false}),
    client.from('rounds').select('id,round_number,deadline_at,status').order('round_number',{ascending:false}),
    client.from('managers').select('id,username').order('created_at'),
    client.from('manager_round_points').select('round_id,manager_id,points')
  ]);
  for(const q of [p,r,m,s])if(q.error)throw q.error;
  const round=r.data?.[0]||null,locked=!round||Date.parse(round.deadline_at)<=Date.now();
  const seasonData=await season.publishedData(client,r.data||[],p.data||[],(m.data||[]).length,round);
  let roster=[],transfers=0;
  if(user&&round){
    const [entries,count]=await Promise.all([
      client.from('roster_entries').select('player_id,slot,is_captain,is_vice_captain').eq('manager_id',user.id).eq('round_id',round.id),
      client.from('transfers').select('id',{head:true,count:'exact'}).eq('manager_id',user.id).eq('round_id',round.id)
    ]);
    if(entries.error||count.error)throw entries.error||count.error;
    roster=entries.data||[];transfers=count.count||0;
  }
  const leaderboard=(m.data||[]).map(x=>({id:x.id,username:x.username,
    points:(s.data||[]).filter(v=>v.manager_id===x.id).reduce((sum,v)=>sum+Number(v.points||0),0)}))
    .sort((a,b)=>b.points-a.points||a.username.localeCompare(b.username,'ru'));
  let myLastTour=null;
  if(user&&seasonData.lastRound){
    const last=seasonData.lastRound;
    let entries=String(round?.id)===String(last.id)?roster:null;
    if(!entries){
      const previous=await client.from('roster_entries')
        .select('player_id,slot,is_captain,is_vice_captain')
        .eq('manager_id',user.id).eq('round_id',last.id);
      if(previous.error)throw previous.error;
      entries=previous.data||[];
    }
    const result=(s.data||[]).find(x=>String(x.round_id)===String(last.id)&&x.manager_id===user.id);
    myLastTour={
      round_number:last.round_number,
      round_id:last.id,
      points:result?Number(result.points):0,
      roster:season.scoredRoster(entries,seasonData.lastStats,p.data||[])
    };
  }
  return {
    players:p.data||[],round,locked,user,roster,transfers,leaderboard,
    lastRound:seasonData.lastRound,
    seasonPlayers:seasonData.seasonPlayers,
    myLastTour
  };
}
module.exports=async function handler(req,res){
  if(req.method!=='GET'&&req.method!=='POST')return send(res,405,{error:'Метод не поддерживается'});
  if(req.method==='POST'&&!originValid(req))return send(res,403,{error:'Запрос с другого сайта отклонён'});
  try{
    const client=db(),user=await currentUser(client,req);
    if(req.method==='GET'){
      if(req.query.action==='adminResults'){
        if(!user?.is_admin)return send(res,403,{error:'Нет прав администратора'});
        return send(res,200,await scoring.adminResults(client,req.query.round));
      }
      if(req.query.action==='roster'){
        const id=String(req.query.manager||''),roundID=Number(req.query.round);
        if(!/^[a-f0-9-]{36}$/i.test(id)||!Number.isSafeInteger(roundID)||roundID<1)
          return send(res,400,{error:'Неверные параметры'});
        const {data:r,error}=await client.from('rounds').select('deadline_at').eq('id',roundID).maybeSingle();
        if(error)throw error;
        if(!r)return send(res,404,{error:'Тур не найден'});
        if(Date.parse(r.deadline_at)>Date.now()&&user?.id!==id)
          return send(res,403,{error:'Чужой состав откроется после дедлайна'});
        const [{data:roster,error:re},{data:publication,error:pe}]=await Promise.all([
          client.from('roster_entries')
            .select('player_id,slot,is_captain,is_vice_captain').eq('round_id',roundID).eq('manager_id',id),
          client.from('round_results_publication').select('round_id').eq('round_id',roundID).maybeSingle()
        ]);
        if(re||pe)throw re||pe;
        if(!publication)return send(res,200,{roster:roster||[],published:false});
        const [statResult,playerResult,pointResult]=await Promise.all([
          client.from('player_round_stats')
            .select('player_id,attended,goals,assists,clean_sheets,penalty_saves,penalty_misses,own_goals,goals_conceded,champion')
            .eq('round_id',roundID),
          client.from('players').select('id,position'),
          client.from('manager_round_points').select('points').eq('round_id',roundID).eq('manager_id',id).maybeSingle()
        ]);
        for(const query of [statResult,playerResult,pointResult])if(query.error)throw query.error;
        return send(res,200,{
          roster:season.scoredRoster(roster||[],statResult.data||[],playerResult.data||[]),
          points:pointResult.data?Number(pointResult.data.points):0,
          published:true
        });
      }
      return send(res,200,await state(client,user));
    }
    const body=typeof req.body==='object'&&req.body!==null?req.body:{};
    if(body.action==='login'||body.action==='register'){
      const username=String(body.username||'').trim(),pin=String(body.pin||'');
      if(username.length<2||username.length>40||!/^[0-9]{6,12}$/.test(pin))
        return send(res,400,{error:'Имя 2–40 символов; PIN 6–12 цифр.'});
      const normalized=username.toLowerCase();
      if(!await throttle(client,req,'account:'+normalized,8,900)||!await throttle(client,req,'auth-global',80,900))
        return send(res,429,{error:'Слишком много попыток. Попробуй через 15 минут.'});
      let manager;
      if(body.action==='register'){
        if(!await throttle(client,req,'registrations',5,3600))
          return send(res,429,{error:'Превышен лимит регистраций с этого адреса.'});
        const {data,error:e}=await client.from('managers').insert({username,pin_hash:pinHash(pin)})
          .select('id,username,is_admin').single();
        if(e){if(e.code==='23505')return send(res,409,{error:'Это имя уже занято.'});throw e;}
        manager=data;
      }else{
        const {data,error:e}=await client.from('managers')
          .select('id,username,is_admin,pin_hash').eq('username_normalized',normalized).maybeSingle();
        if(e)throw e;
        if(!data||!pinVerify(pin,data.pin_hash))return send(res,401,{error:'Неверное имя или PIN.'});
        manager={id:data.id,username:data.username,is_admin:data.is_admin};
      }
      const token=randomBytes(32).toString('hex');
      const {error:e}=await client.from('manager_sessions').insert({manager_id:manager.id,
        token_hash:sha(token),expires_at:new Date(Date.now()+30*86400000).toISOString()});
      if(e)throw e;
      setCookie(res,token,30*86400);
      return send(res,200,{user:manager});
    }
    if(body.action==='logout'){
      const token=getCookie(req,SESSION_COOKIE);
      if(token)await client.from('manager_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',sha(token));
      setCookie(res,'',0);
      return send(res,200,{ok:true});
    }
    if(!user)return send(res,401,{error:'Сначала войди по имени и PIN.'});
    if(body.action==='adminSaveResults'||body.action==='adminPublishResults'){
      if(!user.is_admin)return send(res,403,{error:'Нет прав администратора'});
      const result=body.action==='adminSaveResults'
        ?await scoring.saveResults(client,user,body)
        :await scoring.publishResults(client,user,body);
      return send(res,200,result);
    }
    if(body.action==='save'){
      if(!Array.isArray(body.roster)||body.roster.length!==8)
        return send(res,400,{error:'Состав должен состоять из 8 игроков.'});
      const {data,error:e}=await client.rpc('save_fantasy_roster',{p_manager:user.id,p_entries:body.roster});
      if(e)return send(res,400,{error:e.message});
      return send(res,200,{ok:true,transfers:e?null:data});
    }
    return send(res,400,{error:'Неизвестная операция'});
  }catch(e){if(e?.status&&e.status>=400&&e.status<500)return send(res,e.status,{error:e.message});return error(res,e);}
};
