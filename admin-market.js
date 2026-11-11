'use strict';
// Separate admin panel, using the same logged-in session as the results editor.
let sfAdminPane='results';
let sfMarket={players:[],loaded:false,loading:false,busy:false,error:''};
function sfHtml(){
 if(!data?.user?.is_admin)return '<section class="panel">Нет доступа к админке.</section>';
 const tabs='<div class="sf-admin-tabs"><button class="outline '+(sfAdminPane==='results'?'sf-tab-on':'')+
  '" data-sfm="results">Результаты матчей</button><button class="outline '+
  (sfAdminPane==='market'?'sf-tab-on':'')+'" data-sfm="market">Игроки и цены</button></div>';
 return tabs+(sfAdminPane==='market'?sfMarketHtml():sfResultsHtml());
}
function sfPrice(n){return Number(n).toFixed(1);}
function sfMarketHtml(){
 if(sfMarket.loading)return '<section class="panel"><h2>Управление рынком</h2><p class="subtle">Загружаем игроков…</p></section>';
 if(!sfMarket.loaded)return '<section class="panel"><h2>Управление рынком</h2><p class="subtle">'+
  esc(sfMarket.error||'Нужно загрузить список футболистов.')+'</p><button class="outline" data-sfm="reload">Повторить</button></section>';
 const rows=sfMarket.players.map(p=>'<div class="sf-market-row"><div class="sf-market-person">'+
  '<strong>'+esc(p.name)+'</strong><small>'+esc(p.position)+(p.active?'':' · неактивен')+'</small></div>'+
  '<label class="sf-market-edit"><span>Цена</span><input class="field" type="number" min="0.1" max="50" step="0.1" inputmode="decimal" '+
  'data-sfm-price-id="'+Number(p.id)+'" value="'+sfPrice(p.price)+'" /></label>'+
  '<button class="outline" data-sfm="update" data-id="'+Number(p.id)+'" '+(sfMarket.busy?'disabled':'')+'>Сохранить цену</button></div>').join('');
 return '<div class="columns"><section class="panel"><h2>Добавить футболиста</h2>'+
  '<p class="muted">Новый футболист сразу появляется на рынке по указанной цене. В уже сохранённые составы он не добавляется автоматически.</p>'+
  '<form id="sfm-add"><label class="sf-label" for="sfm-name">Имя и фамилия</label>'+
  '<input id="sfm-name" class="field" type="text" minlength="2" maxlength="60" autocomplete="off" required placeholder="Имя футболиста" />'+
  '<label class="sf-label" for="sfm-position">Позиция</label><select id="sfm-position" class="field">'+
  '<option value="Полевой">Полевой</option><option value="Вратарь">Вратарь</option></select>'+
  '<label class="sf-label" for="sfm-price">Стоимость · бюджет 50</label>'+
  '<input id="sfm-price" class="field" type="number" min="0.1" max="50" step="0.1" inputmode="decimal" required placeholder="5.0" />'+
  '<div class="actions"><button class="primary" type="submit" '+(sfMarket.busy?'disabled':'')+'>Добавить на рынок</button></div></form>'+
  '<div class="warning">Стоимость уже приобретённых футболистов зафиксирована при сохранении состава. Новую рыночную цену применяем к новым покупкам. Это защищает чужие сохранённые составы от превышения бюджета.</div>'+
  '<p class="muted">Рыночные цены можно менять с шагом 0.1 от 0.1 до 50.0. Удаление игроков не предусмотрено, чтобы не нарушить историю туров.</p>'+
  '</section><section class="panel"><h2>Изменение стоимости</h2>'+
  '<p class="muted">Игроков в базе: '+sfMarket.players.length+'. Нажми «Сохранить цену» рядом с нужным футболистом.</p>'+
  '<input class="search" type="search" id="sfm-search" placeholder="Поиск футболиста" autocomplete="off" />'+
  '<div class="sf-market-list" id="sfm-list">'+rows+'</div></section></div>';
}
async function sfMarketLoad(){
 if(!data?.user?.is_admin||sfMarket.loading)return;
 sfMarket.loading=true;sfMarket.error='';render();
 try{
  const response=await fetch('/api/handler?action=adminMarket',{credentials:'same-origin'});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Не удалось загрузить игроков');
  sfMarket.players=result.players||[];
  sfMarket.loaded=true;
 }catch(err){sfMarket.loaded=false;sfMarket.error=err.message;}
 finally{sfMarket.loading=false;render();}
}
async function sfAddFootballer(event){
 event.preventDefault();
 if(sfMarket.busy)return;
 const form=event.target;
 if(!form.reportValidity())return;
 const name=document.getElementById('sfm-name').value.trim();
 const position=document.getElementById('sfm-position').value;
 const price=Number(document.getElementById('sfm-price').value);
 if(!name)return flash('Введи имя футболиста.',true);
 sfMarket.busy=true;
 try{
  await api('adminAddPlayer',{name,position,price});
  sfMarket.loaded=false;sfMarket.busy=false;
  await sfMarketLoad();
  await refresh();
  flash('Футболист «'+name+'» добавлен на рынок.');
 }catch(err){flash(err.message,true);}
 finally{sfMarket.busy=false;render();}
}
async function sfChangePrice(id){
 if(sfMarket.busy)return;
 const player=sfMarket.players.find(p=>Number(p.id)===Number(id));
 const input=document.querySelector('[data-sfm-price-id="'+Number(id)+'"]');
 if(!player||!input)return;
 if(!input.reportValidity())return;
 const price=Number(input.value);
 if(!Number.isFinite(price)||price<=0||price>50)return flash('Неверная цена.',true);
 if(Math.abs(price-Number(player.price))<0.00001)return flash('Цена не изменилась.');
 if(!window.confirm('Изменить цену «'+player.name+'» с '+sfPrice(player.price)+' на '+sfPrice(price)+'? У уже купивших игрока менеджеров останется их цена покупки.'))return;
 sfMarket.busy=true;
 try{
  await api('adminUpdatePrice',{player_id:player.id,price});
  sfMarket.loaded=false;sfMarket.busy=false;
  await sfMarketLoad();
  await refresh();
  flash('Цена «'+player.name+'» изменена на '+sfPrice(price)+'.');
 }catch(err){flash(err.message,true);}
 finally{sfMarket.busy=false;render();}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button[data-sfm]');if(!button)return;
 const action=button.dataset.sfm;
 if(action==='results'){sfAdminPane='results';render();if(!sfAdmin.ready&&!sfAdmin.loading)sfLoad();}
 if(action==='market'){sfAdminPane='market';render();if(!sfMarket.loaded&&!sfMarket.loading)sfMarketLoad();}
 if(action==='reload')sfMarketLoad();
 if(action==='update')sfChangePrice(button.dataset.id);
});
document.addEventListener('input',event=>{
 if(event.target.id!=='sfm-search')return;
 const needle=event.target.value.trim().toLocaleLowerCase('ru');
 for(const row of document.querySelectorAll('.sf-market-row')){
  const text=row.querySelector('.sf-market-person strong')?.textContent||'';
  row.hidden=!text.toLocaleLowerCase('ru').includes(needle);
 }
});
document.addEventListener('submit',event=>{
 if(event.target.id==='sfm-add')sfAddFootballer(event);
});
