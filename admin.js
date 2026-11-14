'use strict';
// Admin interface: all edits remain local until saved. Publication is explicit.
let sfAdmin={loading:false,ready:false,busy:false,error:'',round:null,rounds:[],players:[],stats:[],index:0,dirty:false,published_at:null};
const sfFields=[
 ['goals','Голы',0,100],['assists','Голевые передачи',0,100],['clean_sheets','Сухие 10-минутные матчи',0,8],
 ['penalty_saves','Отбитые пенальти',0,100],['penalty_misses','Незабитые пенальти',0,100],
 ['own_goals','Автоголы',0,100]
];
const sfVisibleFields=()=>sfFields.concat(Number(sfAdmin.round?.round_number)>=2
 ?[['goal_difference','Разница мячей команды за вечер (забитые − пропущенные)',-100,100]]
 :[['goals_conceded','Пропущено командой за весь вечер',0,100]]);
function sfDefaultStat(playerId){
 return {player_id:Number(playerId),attended:false,goals:0,assists:0,clean_sheets:0,
  penalty_saves:0,penalty_misses:0,own_goals:0,goals_conceded:0,goal_difference:0,champion:false};
}
function sfCalc(stat,position,roundNumber=1){
 if(!stat?.attended)return 0;
 const n=key=>Number(stat[key]||0);
 return 1+n('goals')*(position==='Вратарь'?10:5)+n('assists')*3+
  n('clean_sheets')*(position==='Вратарь'?3:1)+n('penalty_saves')*5-
  n('penalty_misses')*2-n('own_goals')*2-
  (Number(roundNumber)>=2?Math.floor(Math.max(0,-n('goal_difference'))/3):Math.floor(n('goals_conceded')/2))+
  (stat.champion?2:0);
}
async function sfLoad(roundId){
 if(!data?.user?.is_admin)return;
 sfAdmin.loading=true;sfAdmin.ready=false;sfAdmin.error='';render();
 try{
  const url='/api/handler?action=adminResults'+(roundId?'&round='+encodeURIComponent(roundId):'');
  const response=await fetch(url,{credentials:'same-origin'});
  const payload=await response.json();
  if(!response.ok)throw Error(payload.error||'Не удалось загрузить статистику');
  sfAdmin.round=payload.round;sfAdmin.rounds=payload.rounds;
  sfAdmin.players=payload.players;sfAdmin.published_at=payload.published_at;
  const stored=new Map((payload.stats||[]).map(x=>[Number(x.player_id),x]));
  sfAdmin.stats=payload.players.map(p=>({...sfDefaultStat(p.id),...(stored.get(Number(p.id))||{})}));
  sfAdmin.index=0;sfAdmin.dirty=false;sfAdmin.ready=true;
 }catch(err){sfAdmin.error=err.message;}
 finally{sfAdmin.loading=false;render();}
}
function sfHtml(){
 if(!data?.user?.is_admin)return '<section class="panel">Нет доступа к админке.</section>';
 if(sfAdmin.loading)return '<section class="panel"><h2>Результаты тура</h2><p>Загружаем статистику…</p></section>';
 if(!sfAdmin.ready)return '<section class="panel"><h2>Результаты тура</h2><p class="subtle">'+
  esc(sfAdmin.error||'Данные ещё не загружены.')+'</p><button class="outline" data-sf="load">Повторить</button></section>';
 const round=sfAdmin.round,players=sfAdmin.players,idx=sfAdmin.index,p=players[idx],s=sfAdmin.stats[idx];
 if(!p||!s)return '<section class="panel">Список футболистов пуст.</section>';
 const attended=sfAdmin.stats.filter(x=>x.attended).length,done=sfAdmin.stats.length;
 const past=Date.now()>=Date.parse(round.deadline_at);
 const score=sfCalc(s,p.position,round.round_number);
 const statsInputs=sfVisibleFields().map(([key,label,min,max])=>
  '<label class="sf-number"><span>'+esc(label)+'</span><input type="number" class="field" data-sf-field="'+key+'" min="'+min+'" max="'+max+'" step="1" inputmode="numeric" value="'+Number(s[key]||0)+'" '+(!s.attended||sfAdmin.busy?'disabled':'')+' /></label>').join('');
 const optionHtml=players.map((player,i)=>'<option value="'+i+'" '+(idx===i?'selected':'')+'>'+
  esc(player.name)+(sfAdmin.stats[i].attended?' • играл':'')+'</option>').join('');
 const roundOptions=sfAdmin.rounds.map(r=>'<option value="'+r.id+'" '+(Number(r.id)===Number(round.id)?'selected':'')+
  '>Тур №'+r.round_number+'</option>').join('');
 return '<div class="columns"><section class="panel"><h2>Админка · результаты тура</h2>'+
  '<p class="muted">Вноси статистику индивидуально. Реальные команды указывать не нужно.</p>'+
  '<label class="sf-label" for="sf-round">Тур</label><select class="field" id="sf-round" '+(sfAdmin.busy?'disabled':'')+'>'+roundOptions+'</select>'+
  '<div class="warning">'+(sfAdmin.published_at?'Очки опубликованы. Исправления после сохранения пересчитываются автоматически.':
  'Результаты ещё не опубликованы: таблица менеджеров не изменится до публикации.')+'</div>'+
  (!past?'<div class="warning">До дедлайна тура сохранение и публикация закрыты.</div>':'')+
  '<p id="sf-unsaved" class="muted">'+(sfAdmin.dirty?'Есть несохранённые изменения.':'Все изменения сохранены.')+'</p>'+
  '<p class="muted">Игроков отметили присутствовавшими: '+attended+' из '+done+'</p>'+
  '<div class="actions"><button class="outline" data-sf="prev" '+(idx===0?'disabled':'')+'>← Предыдущий</button>'+
  '<button class="outline" data-sf="next" '+(idx>=done-1?'disabled':'')+'>Следующий →</button></div>'+
  '<label class="sf-label" for="sf-player">Футболист '+(idx+1)+' / '+done+'</label>'+
  '<select class="field" id="sf-player">'+optionHtml+'</select>'+
  '<div class="sf-attendance"><label><input type="checkbox" id="sf-attended" '+(s.attended?'checked':'')+
  (sfAdmin.busy?' disabled':'')+' /> Участвовал в играх</label></div>'+
  '<label class="sf-attendance"><input type="checkbox" id="sf-champion" '+(s.champion?'checked':'')+
  (!s.attended||sfAdmin.busy?' disabled':'')+' /> Чемпион вечера (+2)</label>'+
  '<div class="sf-stats-grid">'+statsInputs+'</div>'+
  '<div class="sf-preview"><span>Очки футболиста</span><strong id="sf-preview-points">'+score+'</strong></div>'+
  '<p class="muted">'+(Number(round.round_number)>=2
    ?'Начиная с тура №2: введи для каждого участника <strong>разницу мячей его команды за весь вечер</strong> (все забитые минус все пропущенные). Отрицательные значения вводятся со знаком минус. За каждые полные −3 мяча — штраф −1; −1 и −2 без штрафа, положительная разница не даёт бонусов.'
    :'Тур №1: штраф −1 за каждые два гола, пропущенных командой футболиста за весь вечер. Это правило сохраняется в истории.')+'</p>'+
  '</section><section class="panel"><h2>Сохранение и публикация</h2>'+
  '<p class="subtle">Сначала заполни всех игравших футболистов, затем сохрани статистику. Можно исправить значения и пересчитать повторно.</p>'+
  '<div class="actions"><button class="primary" data-sf="save" '+(!past||sfAdmin.busy?'disabled':'')+'>'+
  (sfAdmin.busy?'Сохранение…':'Сохранить статистику')+'</button>'+
  '<button class="outline" data-sf="publish" '+(!past||sfAdmin.busy?'disabled':'')+
  '>Опубликовать очки</button></div>'+
  '<div class="divider"></div><h2>Предварительные очки футболистов</h2>'+
  '<div class="sf-score-list">'+players.map((player,i)=>({player,i,pts:sfCalc(sfAdmin.stats[i],player.position,round.round_number)}))
   .filter(x=>sfAdmin.stats[x.i].attended).sort((a,b)=>b.pts-a.pts)
   .map(x=>'<button class="sf-score-row" data-sf="choose" data-index="'+x.i+'"><span>'+
    esc(x.player.name)+'</span><strong>'+x.pts+'</strong></button>').join('')+
  (!attended?'<p class="muted">Отметь футболистов, которые играли.</p>':'')+'</div>'+
  '</section></div>';
}
function sfRefreshPreview(){
 const el=document.getElementById('sf-preview-points');
 if(el)el.textContent=sfCalc(sfAdmin.stats[sfAdmin.index],sfAdmin.players[sfAdmin.index].position,sfAdmin.round.round_number);
 const status=document.getElementById('sf-unsaved');if(status)status.textContent='Есть несохранённые изменения.';
}
async function sfSave(silent=false){
 if(sfAdmin.busy||!sfAdmin.ready)return false;
 sfAdmin.busy=true;
 try{
  await api('adminSaveResults',{round_id:sfAdmin.round.id,stats:sfAdmin.stats});
  sfAdmin.dirty=false;
  if(sfAdmin.published_at)sfAdmin.published_at=new Date().toISOString();
  if(!silent){await refresh();flash('Статистика сохранена. '+(sfAdmin.published_at?'Очки менеджеров пересчитаны.':'Для показа очков нажми «Опубликовать».'));}
  return true;
 }catch(err){flash(err.message,true);return false;}
 finally{sfAdmin.busy=false;render();}
}
async function sfPublish(){
 if(sfAdmin.busy||!sfAdmin.ready)return;
 if(sfAdmin.dirty){const ok=await sfSave(true);if(!ok)return;}
 sfAdmin.busy=true;render();
 try{
  const result=await api('adminPublishResults',{round_id:sfAdmin.round.id});
  sfAdmin.published_at=new Date().toISOString();
  await refresh();
  flash('Результаты опубликованы. Пересчитаны очки '+result.managers+' менеджеров.');
 }catch(err){flash(err.message,true);}
 finally{sfAdmin.busy=false;render();}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button[data-sf]');if(!button)return;
 const action=button.dataset.sf;
 if(action==='load')sfLoad(sfAdmin.round?.id);
 if(action==='prev'&&sfAdmin.index>0){sfAdmin.index--;render();}
 if(action==='next'&&sfAdmin.index<sfAdmin.players.length-1){sfAdmin.index++;render();}
 if(action==='choose'){sfAdmin.index=Number(button.dataset.index);render();}
 if(action==='save')sfSave();
 if(action==='publish')sfPublish();
});
document.addEventListener('change',event=>{
 if(!data?.user?.is_admin)return;
 const target=event.target;
 if(target.id==='sf-round'){
  if(sfAdmin.dirty&&!window.confirm('Есть несохранённые изменения. Перейти к другому туру без сохранения?')){
   target.value=String(sfAdmin.round.id);return;
  }
  sfLoad(target.value);
 }
 if(target.id==='sf-player'){sfAdmin.index=Number(target.value);render();}
 if(target.id==='sf-attended'||target.id==='sf-champion'){
  const stat=sfAdmin.stats[sfAdmin.index];if(!stat)return;
  if(target.id==='sf-attended'){
   stat.attended=target.checked;
   if(!stat.attended){for(const [field] of [...sfFields,['goals_conceded'],['goal_difference']])stat[field]=0;stat.champion=false;}
  }else stat.champion=target.checked;
  sfAdmin.dirty=true;render();
 }
});
document.addEventListener('input',event=>{
 const field=event.target.dataset?.sfField;
 if(!field||!sfAdmin.ready||sfAdmin.busy)return;
 const definition=sfVisibleFields().find(x=>x[0]===field);if(!definition)return;
 const val=Number(event.target.value);
 if(!Number.isInteger(val)||val<definition[2]||val>definition[3]){event.target.setCustomValidity('Введи целое число от '+definition[2]+' до '+definition[3]);return;}
 event.target.setCustomValidity('');
 sfAdmin.stats[sfAdmin.index][field]=val;
 sfAdmin.dirty=true;sfRefreshPreview();
});
