'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash=n=>Number(n||0).toFixed(1);
let data=null, draft=[], tab='team', search='', filter='all', saving=false;
const byId=id=>data?.players?.find(p=>Number(p.id)===Number(id));
const pos=p=>p?.position==='Вратарь'?'Вратарь':'Полевой';
const used=()=>draft.reduce((a,e)=>a+Number(byId(e.player_id)?.price||0),0);
const locked=()=>!data||data.locked;
const scored=n=>(Number(n)>0?'+':'')+String(Number(n)||0);
const slotTitle=e=>e.slot==='goalkeeper'?'Вратарь':e.slot==='starter'?'Основа':e.slot==='bench1'?'Запас 1':'Запас 2';
const lastRoundIsCurrent=()=>Boolean(data?.myLastTour&&String(data?.round?.id)===String(data.myLastTour.round_id));
const latestEntry=id=>lastRoundIsCurrent()?data.myLastTour.roster.find(e=>Number(e.player_id)===Number(id)):null;
const unusedBench=e=>Boolean(e&&e.attended&&!e.counted&&(e.slot==='bench1'||e.slot==='bench2'));
const displayedPlayerPoints=e=>unusedBench(e)?Number(e.raw_points??0):Number(e.points??0);
function scoreBadge(e){
 if(!e)return '';
 const unused=unusedBench(e);
 const detail=!e.attended?'не играл':unused?'не вышел · не в зачёт':e.substituted?'замена':e.multiplier===2?'×2':'';
 const title=unused?'Личные очки футболиста: не засчитаны в результат команды':'Очки, принесённые фэнтези-команде';
 return '<span class="score-badge'+(unused?' score-badge-unused':'')+'" title="'+title+'">'+scored(displayedPlayerPoints(e))+
  '<small>'+detail+'</small></span>';
}
function myLastTourHtml(){
 const tour=data?.myLastTour;
 if(!tour){
  return '<section class="panel tour-summary"><h2>Очки последнего тура</h2><p class="muted">'+
   (data?.lastRound?'Войди в аккаунт, чтобы увидеть свои очки.':'Результаты туров пока не опубликованы.')+
   '</p></section>';
 }
 const same=lastRoundIsCurrent();
 let html='<section class="panel tour-summary"><div class="tour-summary-header"><div><h2>Твой результат · тур №'+
  tour.round_number+'</h2><p class="muted">Итог с учётом автозамен и капитана</p></div>'+
  '<strong class="tour-total">'+scored(tour.points)+' <span>очков</span></strong></div>';
 if(!tour.roster.length)html+='<p class="muted">На этот тур состав не был сохранён.</p>';
 if(!same&&tour.roster.length){
  html+='<p class="muted">Ниже — состав последнего завершённого тура. У запасных с пометкой «не вышел» видны личные очки, которые не засчитаны команде.</p>'+
   '<div class="tour-history-list">'+tour.roster.map(e=>{
     const p=byId(e.player_id);
     return '<div class="tour-history-item"><div><strong>'+esc(p?.name||'Футболист №'+e.player_id)+'</strong>'+
       '<small>'+esc(slotTitle(e))+(e.is_captain?' · К':e.is_vice_captain?' · ВК':'')+'</small></div>'+
       scoreBadge(e)+'</div>';
    }).join('')+'</div>';
 }
 if(same)html+='<p class="muted">Очки каждого футболиста показаны на поле и рядом с его именем в составе ниже. У запасных, не вышедших на замену, указаны их личные очки — в результат команды они не включаются.</p>';
 return html+'</section>';
}
function flash(message,isError=false){const el=$('notice');el.innerHTML='<div class="message'+(isError?' error':'')+'">'+esc(message)+'</div>';window.scrollTo({top:0,behavior:'smooth'});}
async function api(action,payload){
 const options=action?{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,...payload})}:{credentials:'same-origin'};
 const r=await fetch('/api/handler',options);let result;
 try{result=await r.json();}catch{throw Error('Сервер вернул неожиданный ответ.');}
 if(!r.ok)throw Error(result.error||'Ошибка '+r.status);
 return result;
}
async function refresh(){
 try{data=await api();draft=(data.roster||[]).map(x=>({...x,player_id:Number(x.player_id)}));render();}
 catch(e){$('content').innerHTML='<section class="panel"><h2>Сайт пока не настроен</h2><p class="subtle">'+esc(e.message)+'</p><p>Подключи Supabase к Vercel и выполни SQL-миграцию.</p></section>';
 $('round-badge').textContent='Нет соединения';}
}
function roomFor(p){
 if(!data?.user||locked()||p.active===false||draft.some(e=>e.player_id===p.id)||draft.length>=8||used()+Number(p.price)>50)return false;
 return p.position==='Вратарь'?draft.every(e=>e.slot!=='goalkeeper'):draft.filter(e=>e.slot!=='goalkeeper').length<7;
}
function assignFlags(){
 const playing=draft.filter(e=>e.slot==='goalkeeper'||e.slot==='starter');
 for(const x of draft)if(x.slot==='bench1'||x.slot==='bench2'){x.is_captain=false;x.is_vice_captain=false;}
 if(!playing.some(x=>x.is_captain)){
  const pick=playing.find(x=>x.slot==='starter')||playing[0];if(pick)pick.is_captain=true;
 }
 if(!playing.some(x=>x.is_vice_captain)){
  const pick=playing.find(x=>!x.is_captain);if(pick)pick.is_vice_captain=true;
 }
}
function addPlayer(id){
 const p=byId(id);if(!p||!roomFor(p))return;
 const slot=p.position==='Вратарь'?'goalkeeper':draft.filter(e=>e.slot==='starter').length<5?'starter':draft.some(e=>e.slot==='bench1')?'bench2':'bench1';
 draft.push({player_id:id,slot,is_captain:false,is_vice_captain:false});assignFlags();render();
}
function removePlayer(id){
 if(locked())return;
 draft=draft.filter(e=>e.player_id!==id);
 const fields=draft.filter(e=>e.slot==='starter');
 const bench=draft.filter(e=>e.slot==='bench1'||e.slot==='bench2');
 // When a starter leaves, fill its vacancy with first available bench player.
 if(fields.length<5&&bench.length){
  const replacement=bench.find(e=>e.slot==='bench1')||bench[0];replacement.slot='starter';
 }
 const remains=draft.filter(e=>e.slot==='bench1'||e.slot==='bench2');
 if(remains.length===1)remains[0].slot='bench1';
 assignFlags();render();
}
function changeCaptain(id,which){
 if(locked())return;
 const selected=draft.find(e=>e.player_id===id);
 if(!selected||!['goalkeeper','starter'].includes(selected.slot))return;
 const key=which==='cap'?'is_captain':'is_vice_captain';
 const other=which==='cap'?'is_vice_captain':'is_captain';
 for(const e of draft)e[key]=e.player_id===id;
 selected[other]=false;
 render();
}
function movePlayer(id){
 if(locked())return;
 const e=draft.find(x=>x.player_id===id);if(!e||e.slot==='goalkeeper')return;
 if(e.slot==='starter'){
  const substitute=draft.find(x=>x.slot==='bench1')||draft.find(x=>x.slot==='bench2');
  if(!substitute)return flash('Чтобы поменять игрока основы, нужен запасной.',true);
  const oldBench=substitute.slot;substitute.slot='starter';e.slot=oldBench;
 }else{
  const starter=draft.find(x=>x.slot==='starter');
  if(!starter)return;
  const oldBench=e.slot;e.slot='starter';starter.slot=oldBench;
 }
 assignFlags();render();
}
function swapBench(){
 if(locked())return;
 const a=draft.find(x=>x.slot==='bench1'),b=draft.find(x=>x.slot==='bench2');
 if(a&&b){a.slot='bench2';b.slot='bench1';render();}
}
async function saveTeam(){
 if(!data?.user)return openLogin();
 if(locked())return flash('Дедлайн уже прошёл.',true);
 if(draft.length!==8)return flash('Сначала набери 8 игроков.',true);
 if(!draft.some(x=>x.is_captain)||!draft.some(x=>x.is_vice_captain))return flash('Выбери капитана и вице-капитана.',true);
 if(saving)return;saving=true;
 try{const free=Boolean(data?.round?.unlimited_transfers);const r=await api('save',{roster:draft});await refresh();flash(free?'Новый состав сохранён. В этом туре количество трансферов не ограничено.':'Состав сохранён на сервере. Использовано трансферов: '+r.transfers+' из 2.');}
 catch(e){flash(e.message,true);}finally{saving=false;}
}
function teamHtml(){
 if(!data?.user)return '<section class="panel"><h2>Собери свою команду</h2><p class="subtle">Войди по имени и PIN или зарегистрируй нового менеджера. Состав будет храниться в общей базе.</p><button class="primary" data-action="login">Войти / создать менеджера</button></section>';
 const rows=draft.map(e=>{const p=byId(e.player_id);if(!p)return '';
  const starter=e.slot==='goalkeeper'||e.slot==='starter';
  return '<div class="entry"><div class="entry-info"><strong>'+esc(p.name)+'</strong><small>'+esc(pos(p))+' · '+slotTitle(e)+' · '+cash(p.price)+'</small></div>'+
   '<div class="entry-actions">'+scoreBadge(latestEntry(p.id))+(starter?'<button class="small-btn '+(e.is_captain?'marked':'')+'" data-action="cap" data-id="'+p.id+'" '+(locked()?'disabled':'')+'>К</button><button class="small-btn '+(e.is_vice_captain?'marked':'')+'" data-action="vice" data-id="'+p.id+'" '+(locked()?'disabled':'')+'>ВК</button>':'')+
   (p.position!=='Вратарь'?'<button class="small-btn" data-action="move" data-id="'+p.id+'" '+(locked()?'disabled':'')+'>'+(starter?'В запас':'В основу')+'</button>':'')+
   '<button class="small-btn" data-action="remove" data-id="'+p.id+'" '+(locked()?'disabled':'')+'>×</button></div></div>';
 }).join('');
 return myLastTourHtml()+(data.round?.unlimited_transfers&&!locked()?'<div class="message">Тур №'+data.round.round_number+': <strong>неограниченные бесплатные трансферы</strong> до 18 ноября, 20:30 по Риге. Можно полностью пересобрать восьмёрку, менять капитана и запасных. Очки прошлого тура сохраняются выше.</div>':'')+'<div class="columns"><section class="panel"><h2>Твой состав · тур №'+data.round?.round_number+'</h2><p class="muted">На поле — 5 полевых по схеме 1–2–2 и вратарь</p><div class="pitch"><div class="formation">'+
  '<div class="slot front">'+chip('starter:0','Нападение')+'</div>'+
  ['mid-left','mid-right','back-left','back-right'].map((c,i)=>'<div class="slot '+c+'">'+chip('starter:'+(i+1),'Основа')+'</div>').join('')+
  '<div class="slot keeper">'+chip('goalkeeper','Вратарь')+'</div></div></div>'+
  '<div class="bench">'+chip('bench1','Запас 1')+chip('bench2','Запас 2')+'</div>'+
  '<div class="actions"><button class="outline" data-action="swap" '+(locked()?'disabled':'')+'>Порядок запаса ⇄</button><button class="primary" data-action="save" '+(locked()?'disabled':'')+'>Сохранить состав</button></div>'+
  (locked()?'<div class="warning">Тур закрыт: изменения состава недоступны.</div>':'<p class="muted">Изменения становятся действительными только после нажатия «Сохранить состав». '+(data.round?.unlimited_transfers?'Лимита трансферов в этом туре нет.':'')+'</p>')+
  '</section><section class="panel"><h2>Управление составом</h2><p class="muted">К — капитан, ВК — вице-капитан. Перестановки между основой и запасом бесплатны.</p>'+
  (rows||'<p class="subtle">Пока нет игроков. Открой рынок.</p>')+
  '<div class="actions"><button class="primary" data-tab="market">'+(draft.length?'Открыть рынок':'Выбрать игроков')+'</button></div></section></div>';
}
function ensureDisplaySlots(){
 // Assign unique rendering positions for the five unordered starters.
 let i=0;for(const e of draft){if(e.slot==='starter')e.displaySlot='starter:'+(i++);else e.displaySlot=e.slot;}
}
function chip(slot,label){
 const e=draft.find(x=>x.displaySlot===slot);
 if(!e)return '<div class="chip placeholder">'+esc(label||'Пусто')+'</div>';
 const p=byId(e.player_id);return '<div class="chip">'+esc(p?.name||'?')+
  '<small>'+(e.is_captain?'Капитан · ':e.is_vice_captain?'Вице · ':'')+cash(p?.price)+'</small>'+
  (latestEntry(e.player_id)?'<span class="chip-score'+(unusedBench(latestEntry(e.player_id))?' chip-score-unused':'')+'">'+scored(displayedPlayerPoints(latestEntry(e.player_id)))+(unusedBench(latestEntry(e.player_id))?' · не вышел':'')+'</span>':'')+'</div>';
}
function marketHtml(){
 const filtered=(data?.players||[]).filter(p=>p.active!==false&&p.name.toLowerCase().includes(search.toLowerCase())&&(filter==='all'||(filter==='gk')===(p.position==='Вратарь')));
 return '<section class="panel"><h2>Рынок игроков</h2><p class="subtle">'+(data?.players||[]).filter(p=>p.active!==false).length+' игроков · бюджет 50.0 · '+(locked()?'Тур закрыт':'Выбирай состав')+'</p>'+
  '<div class="row"><input class="search" id="search" placeholder="Поиск игрока" value="'+esc(search)+'" /><select id="filter" class="field" style="width:auto"><option value="all" '+(filter==='all'?'selected':'')+'>Все</option><option value="gk" '+(filter==='gk'?'selected':'')+'>Вратари</option><option value="field" '+(filter==='field'?'selected':'')+'>Полевые</option></select></div>'+
  '<div class="market-list" id="market-list">'+marketRows(filtered)+'</div></section>';
}
function marketRows(players){return players.map(p=>{
 const selected=draft.some(e=>e.player_id===p.id);
 return '<div class="entry"><div class="entry-info"><strong>'+esc(p.name)+'</strong><small>'+pos(p)+'</small></div><strong class="price">'+cash(p.price)+'</strong>'+
  '<button class="small-btn" data-action="'+(selected?'remove':'add')+'" data-id="'+p.id+'" '+((selected?!locked():roomFor(p))?'':'disabled')+'>'+(selected?'Убрать':'Добавить')+'</button></div>';
}).join('')||'<p class="muted">Игроки не найдены.</p>';}
function leagueHtml(){
 const people=data?.leaderboard||[];
 return '<section class="panel"><h2>Таблица менеджеров</h2><p class="muted">Нажми на имя, чтобы посмотреть состав и вклад каждого футболиста в последнем завершённом туре. Составы ещё не завершённых туров скрыты до дедлайна.</p>'+
  '<table class="league"><thead><tr><th>№</th><th>Менеджер</th><th>Очки за сезон</th></tr></thead><tbody>'+
  people.map((m,i)=>'<tr><td>'+(i+1)+'</td><td><button class="link" data-action="view" data-id="'+esc(m.id)+'">'+esc(m.username)+'</button></td><td>'+scored(m.points)+'</td></tr>').join('')+
  '</tbody></table>'+(people.length?'':'<p class="muted">Менеджеров пока нет.</p>')+'</section>';
}
function playerPointsHtml(){
 const players=data?.seasonPlayers||[];
 const count=data?.leaderboard?.length||0;
 return '<section class="panel"><h2>Очки футболистов</h2>'+
  '<p class="subtle">Очки за все опубликованные туры сезона. Владение — сколько зарегистрированных менеджеров включили футболиста в свою команду на текущий тур.</p>'+
  '<p class="muted">Менеджеров в лиге: '+count+'. Процент рассчитывается от всех '+count+' аккаунтов, даже если состав ещё не собран.</p>'+
  '<input id="player-points-search" class="search" type="search" placeholder="Найти футболиста" aria-label="Поиск футболиста">'+
  '<div class="table-scroll"><table class="league player-points-table"><thead><tr><th>Футболист</th><th>Очки за сезон</th><th>Владение</th></tr></thead><tbody>'+
  players.map(p=>'<tr data-player-name="'+esc(p.name.toLocaleLowerCase('ru'))+'"><td><strong>'+esc(p.name)+'</strong></td>'+
   '<td class="numeric">'+scored(p.season_points)+'</td>'+
   '<td class="numeric">'+Number(p.ownership_percent).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+
   '% <small>('+p.owners+'/'+count+')</small></td></tr>').join('')+
  '</tbody></table></div>'+
  (!players.length?'<p class="muted">Футболистов пока нет.</p>':'')+
  '</section>';
}
function rulesHtml(){
 const scoring=[['Участие','+1'],['Гол полевого','+5'],['Гол вратаря','+10'],['Голевая передача','+3'],['Сухой 10-минутный матч полевого','+1'],['Сухой 10-минутный матч вратаря','+3'],['Отбитый пенальти','+5'],['Незабитый пенальти','−2'],['Автогол','−2'],['Чемпион вечера','+2'],['Каждые 2 пропущенных гола команды за весь вечер','−1 каждому футболисту']];
 return '<section class="panel rules"><h2>Правила Sreda Fantasy</h2><ul><li>Бюджет — <strong>50.0</strong>. В составе 1 вратарь, 5 полевых в основе и 2 полевых в запасе.</li><li>Обычно доступно <strong>2 трансфера за тур</strong>, они не переносятся. В турах с режимом свободной пересборки число трансферов не ограничено.</li><li>Дедлайн — <strong>среда, 20:30 Europe/Riga</strong>. После него изменения заблокированы.</li><li>При отсутствии полевого игрока основы вступает присутствующий запасной, по приоритету 1 → 2. Вратарь без замены.</li><li>Капитан получает ×2, если присутствовал. Если нет — ×2 получает присутствующий вице-капитан.</li></ul><h2>Очки за игру</h2><table class="league">'+scoring.map(s=>'<tr><td>'+s[0]+'</td><td>'+s[1]+'</td></tr>').join('')+'</table><p class="muted">Штраф за пропущенные голы применяется к каждому участвовавшему футболисту, включая вратаря. Для капитана он тоже удваивается.</p></section>';
}
function render(){
 if(!data)return;
 let adminNav=document.querySelector('.nav button[data-tab="admin"]');
 if(data.user?.is_admin){
  if(!adminNav){adminNav=document.createElement('button');adminNav.dataset.tab='admin';adminNav.textContent='Админка';document.querySelector('.nav').appendChild(adminNav);}
 }else if(adminNav){adminNav.remove();if(tab==='admin')tab='team';}
 ensureDisplaySlots();
 $('round-badge').textContent=data.round?'Тур №'+data.round.round_number+(data.locked?' · закрыт':' · открыт'):'Тур не создан';
 $('login-btn').textContent=data.user?data.user.username+' · Выход':'Войти';
 $('budget').textContent=cash(50-used());$('count').textContent=draft.length+' / 8';
 $('transfers').textContent=data.round?.unlimited_transfers?'∞':(2-data.transfers)+' / 2';
 $('transfers').nextElementSibling.textContent=data.round?.unlimited_transfers?'бесплатно до дедлайна':'на текущий тур';
 $('deadline-short').textContent=data.round?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Riga',day:'numeric',month:'short'}).format(new Date(data.round.deadline_at)):'—';
 document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 $('content').innerHTML=tab==='team'?teamHtml():tab==='market'?marketHtml():tab==='league'?leagueHtml():tab==='points'?playerPointsHtml():tab==='admin'?sfHtml():rulesHtml();
}
function openLogin(){
 $('modal').hidden=false;
 $('modal').innerHTML='<div class="dialog"><h2>Вход менеджера</h2><p class="subtle">Первый раз? Выбери «Создать». Уже есть аккаунт? Нажми «Войти».</p><form id="auth-form"><label for="username">Имя менеджера</label><input id="username" class="field" maxlength="40" autocomplete="username" required />'+
  '<label for="pin">PIN из 6–12 цифр</label><input id="pin" type="password" class="field" inputmode="numeric" minlength="6" maxlength="12" pattern="[0-9]{6,12}" autocomplete="current-password" required />'+
  '<div class="actions"><button class="primary" type="submit" name="mode" value="login">Войти</button><button class="outline" type="submit" name="mode" value="register">Создать</button><button class="outline" type="button" data-action="close">Отмена</button></div></form><p class="muted">Не используй PIN от банковских карт или других сервисов.</p></div>';
 $('username').focus();
}
async function submitAuth(event){
 event.preventDefault();const submitter=event.submitter;
 const action=submitter?.value==='register'?'register':'login';
 const username=$('username').value.trim(),pin=$('pin').value;
 try{await api(action,{username,pin});$('modal').hidden=true;$('modal').innerHTML='';await refresh();flash('Ты вошёл как '+username+'.');}
 catch(e){const old=$('modal').querySelector('.modal-error');if(old)old.remove();$('auth-form').insertAdjacentHTML('beforeend','<p class="message error modal-error">'+esc(e.message)+'</p>');}
}
async function openManager(managerID){
 const round=data?.lastRound||data?.round;
 if(!round)return flash('Тур не создан.',true);
 try{
  const response=await fetch('/api/handler?action=roster&manager='+encodeURIComponent(managerID)+'&round='+round.id);
  const payload=await response.json();if(!response.ok)throw Error(payload.error||'Доступ закрыт');
  const manager=data.leaderboard.find(m=>m.id===managerID);
  const roster=payload.roster||[];
  const total=payload.published?'<div class="modal-total"><span>Очки за тур №'+round.round_number+'</span><strong>'+scored(payload.points)+'</strong></div>':'';
  const content=roster.length?roster.map(e=>{
    const p=byId(e.player_id);
    const meta=esc(slotTitle(e))+(e.is_captain?' · капитан':e.is_vice_captain?' · вице-капитан':'');
    return '<div class="entry"><div class="entry-info"><strong>'+esc(p?.name||'Футболист №'+e.player_id)+'</strong>'+
      '<small>'+meta+(payload.published?(e.attended?(e.counted?(e.substituted?' · вышел на замену':''):(e.slot==='bench1'||e.slot==='bench2'?' · не вышел':'')):' · не играл'):'')+'</small></div>'+
      (payload.published?scoreBadge(e):'<span>'+esc(e.is_captain?'К':e.is_vice_captain?'ВК':'')+'</span>')+'</div>';
   }).join(''):'<p class="subtle">Состав не сохранён.</p>';
  $('modal').hidden=false;
  $('modal').innerHTML='<div class="dialog"><h2>'+esc(manager?.username||'Менеджер')+'</h2>'+
   (payload.published?'<p class="muted">Состав последнего опубликованного тура №'+round.round_number+'. Очки включают капитанские бонусы и замены.</p>':'<p class="muted">Состав тура №'+round.round_number+'</p>')+
   total+'<div class="modal-roster-scroll">'+content+'</div>'+
   '<div class="actions"><button class="outline" data-action="close">Закрыть</button></div></div>';
 }catch(e){flash(e.message,true);}
}
async function logout(){try{await api('logout');await refresh();flash('Ты вышел из аккаунта.');}catch(e){flash(e.message,true);}}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.tab){tab=button.dataset.tab;render();if(tab==='admin'&&!sfAdmin.ready&&!sfAdmin.loading)sfLoad();return;}
 if(button.id==='login-btn'){if(data?.user)logout();else openLogin();return;}
 const id=Number(button.dataset.id),action=button.dataset.action;
 if(action==='login')openLogin();else if(action==='close'){$('modal').hidden=true;$('modal').innerHTML='';}
 else if(action==='add')addPlayer(id);else if(action==='remove')removePlayer(id);
 else if(action==='cap'||action==='vice')changeCaptain(id,action);
 else if(action==='move')movePlayer(id);else if(action==='swap')swapBench();
 else if(action==='save')saveTeam();else if(action==='view')openManager(button.dataset.id);
});
document.addEventListener('input',event=>{
 if(event.target.id==='player-points-search'){
  const needle=event.target.value.toLocaleLowerCase('ru').trim();
  document.querySelectorAll('[data-player-name]').forEach(row=>{
    row.hidden=!row.dataset.playerName.includes(needle);
  });
  return;
 }
 if(event.target.id!=='search')return;
 search=event.target.value;
 const filtered=(data?.players||[]).filter(p=>p.active!==false&&p.name.toLowerCase().includes(search.toLowerCase())&&(filter==='all'||(filter==='gk')===(p.position==='Вратарь')));
 $('market-list').innerHTML=marketRows(filtered);
});
document.addEventListener('change',event=>{if(event.target.id==='filter'){filter=event.target.value;render();}});
document.addEventListener('submit',event=>{if(event.target.id==='auth-form')submitAuth(event);});
refresh();
