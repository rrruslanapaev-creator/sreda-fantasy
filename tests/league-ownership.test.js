const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const from=app.indexOf('const ownershipManagerCount=()=>');
const until=app.indexOf('function rulesHtml(){',from);
if(from<0||until<0)throw Error('Ownership UI functions not found');
const impl=app.slice(from,until);
function make(count=12){
 const sample=Array.from({length:count},(_,i)=>({
  player_id:i+1,name:'Игрок '+(i+1),position:'Полевой',season_points:100-i,
  average_points_per_round:i===0?3.5:i===1?0:i===2?null:1.2,
  owners:i===0?4:i===1?7:i===2?2:i===3?0:1,
  ownership_percent:i===0?40:i===1?70:i===2?20:i===3?0:10
 }));
 const data={seasonPlayers:sample,leaderboard:Array.from({length:10},(_,i)=>({
  id:'manager-'+i,username:'Менеджер '+i,points:i
 }))};
 const ctx={
  data,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),
  scored:n=>String(n),Number,render:()=>{}
 };
 return {data,api:vm.runInNewContext(impl+';({ownershipText,popularPlayersHtml,leagueHtml,playerPointsHtml,displayAveragePoints,sortStats,sortPlayerStats})',ctx)};
}
test('League shows ten most popular footballers sorted by ownership, not season points',()=>{
 const {api}=make();
 const h=api.leagueHtml();
 assert.match(h,/Таблица менеджеров/);
 assert.match(h,/Самые популярные футболисты/);
 assert.match(h,/Владение/);
 const first=h.indexOf('Игрок 2'),second=h.indexOf('Игрок 1');
 assert.ok(first>=0&&second>first,'70% owner should rank before 40% owner');
 assert.match(h,/70,0%/);
 assert.match(h,/40,0%/);
 assert.match(h,/7\/10/);
 assert.match(h,/data-tab="points"/);
});
test('Players has only total, published-round average and ownership columns',()=>{
 const {api}=make();
 const h=api.playerPointsHtml();
 assert.match(h,/Очки футболистов/);
 assert.match(h,/Всего очков/);
 assert.match(h,/Среднее за тур/);
 assert.match(h,/Владение/);
 assert.match(h,/0,0%/);
 assert.match(h,/70,0%/);
 assert.match(h,/Игрок 12/);
 assert.match(h,/3,5/);
 assert.match(h,/—/);
 const headings=Array.from(h.matchAll(/<th(?:\s[^>]*)?>/g));
 assert.equal(headings.length,4); // name + precisely three requested metrics
 for(const heading of ['Форма','Голы','Ассисты','Рейтинг','Купили','Продали']) {
   assert.doesNotMatch(h,new RegExp('<th>'+heading+'</th>'));
 }
});
test('Missing average is not misrepresented as zero before any results are published',()=>{
 const {api}=make();
 assert.equal(api.displayAveragePoints(null),'—');
 assert.equal(api.displayAveragePoints(undefined),'—');
 assert.equal(api.displayAveragePoints(0),'0,0');
 assert.equal(api.displayAveragePoints(2.3),'2,3');
});
test('Manager roster ownership shows eligible-team denominator',()=>{
 const {api}=make();
 assert.equal(api.ownershipText(2),'Владение: 70,0% (7 из 10)');
 assert.equal(api.ownershipText(4),'Владение: 0,0% (0 из 10)');
 assert.equal(api.ownershipText(999),'Владение: —');
});
test('Excludes empty accounts from ownership denominator throughout League and Players',()=>{
 const {data,api}=make();
 data.ownershipManagerCount=8; // 10 account records, only 8 completed a team
 data.seasonPlayers[1].ownership_percent=87.5;
 assert.equal(api.ownershipText(2),'Владение: 87,5% (7 из 8)');
 assert.match(api.playerPointsHtml(),/7\/8/);
 assert.match(api.playerPointsHtml(),/87,5%/);
 assert.match(api.leagueHtml(),/7\/8/);
 assert.match(api.leagueHtml(),/87,5%/);
});
test('Popular-footballer panel does not crash with an empty league',()=>{
 const {data,api}=make(0);
 assert.equal(api.popularPlayersHtml(),'');
 assert.match(api.leagueHtml(),/Таблица менеджеров/);
});
test('Preview roster dialog explicitly uses demonstration data and not live future rosters',()=>{
 const start=app.indexOf('async function openManager(managerID){');
 const end=app.indexOf('async function logout(){',start);
 assert.ok(start>=0&&end>start);
 const part=app.slice(start,end);
 assert.match(part,/if\(data\?\.previewMode\)/);
 assert.match(part,/payload=\{roster:data\.roster\|\|\[\],published:false,demo:true\}/);
 assert.match(part,/не реальный состав этого менеджера/);
 assert.match(part,/historicalPitchHtml\(roster,Boolean\(payload\.published\)\)/);
 assert.match(part,/const round=data\?\.lastRound\|\|\(data\?\.previewMode\?data\?\.round:null\)/);
 assert.match(part,/if\(!payload\.published\)throw Error/);
 const pitch=app.slice(app.indexOf('function historicalPitchHtml('),start);
 assert.match(pitch,/ownershipText\(e\.player_id\)/);
});

test('Every metric sorts numerically both ways; missing averages stay last',()=>{
 const {data,api}=make();
 api.sortStats('ownership_percent');
 let h=api.playerPointsHtml();
 assert.ok(h.indexOf('Игрок 2')<h.indexOf('Игрок 1'));
 assert.match(h,/aria-sort="descending"><button[^>]*data-sort="ownership_percent"/);
 api.sortStats('ownership_percent');
 h=api.playerPointsHtml();
 assert.ok(h.indexOf('Игрок 4')<h.indexOf('Игрок 2'));
 assert.match(h,/aria-sort="ascending"><button[^>]*data-sort="ownership_percent"/);
 api.sortStats('average_points_per_round');
 assert.equal(api.sortPlayerStats(data.seasonPlayers,'average_points_per_round',-1).at(-1).player_id,3);
 assert.equal(api.sortPlayerStats(data.seasonPlayers,'average_points_per_round',1).at(-1).player_id,3);
 api.sortStats('season_points');
 h=api.playerPointsHtml();
 assert.match(h,/aria-sort="descending"><button[^>]*data-sort="season_points"/);
 assert.ok(h.indexOf('Игрок 1')<h.indexOf('Игрок 2'));
});

test('Historical modal renders an actual field, bench and credited points without editable buttons',()=>{
 const start=app.indexOf('function historicalPitchHtml('),end=app.indexOf('async function openManager(',start);
 const part=app.slice(start,end);
 const roster=[
  {player_id:1,slot:'goalkeeper',attended:true,counted:true,points:22,raw_points:22},
  {player_id:2,slot:'starter',is_captain:true,attended:true,counted:true,points:14,raw_points:7,multiplier:2},
  {player_id:3,slot:'starter',is_vice_captain:true,attended:false,counted:false,points:0},
  {player_id:4,slot:'starter',attended:true,counted:true,points:5},
  {player_id:5,slot:'starter',attended:true,counted:true,points:1},
  {player_id:6,slot:'starter',attended:true,counted:true,points:2},
  {player_id:7,slot:'bench1',attended:true,counted:true,substituted:true,points:0,raw_points:0},
  {player_id:8,slot:'bench2',attended:true,counted:false,points:0,raw_points:8}
 ];
 const before=JSON.stringify(roster);
 const ctx={roster,byId:id=>({name:'Игрок '+id}),esc:String,scored:n=>String(n),
  unusedBench:e=>e.attended&&!e.counted&&e.slot.startsWith('bench'),
  displayedPlayerPoints:e=>e.attended&&!e.counted&&e.slot.startsWith('bench')?e.raw_points:e.points,
  ownershipText:()=> 'Владение: 20%',ownershipDetails:()=>({percent:'20%'})
 };
 const h=vm.runInNewContext(part+';historicalPitchHtml(roster,true)',ctx);
 assert.match(h,/class="pitch"/);assert.match(h,/class="formation"/);assert.match(h,/class="bench"/);
 assert.equal((h.match(/class="chip history-chip/g)||[]).length,8);
 assert.match(h,/history-substituted/);assert.match(h,/Автозамена/);
 assert.match(h,/Не играл/);assert.match(h,/Не вышел/);
 assert.match(h,/history-points-unused[^>]*>8/);
 assert.match(h,/×2 · в зачёт/);assert.match(h,/20% влад\./);
 assert.doesNotMatch(h,/data-action=|<button/);
 assert.equal(JSON.stringify(roster),before);
});
test('Without a published round, production manager view never requests the current round',async()=>{
 const start=app.indexOf('async function openManager(managerID){'),end=app.indexOf('async function logout(){',start);
 const part=app.slice(start,end);
 let requests=0;let message='';
 await vm.runInNewContext(part+';openManager("manager-id")',{
   data:{round:{id:3,round_number:3},lastRound:null,previewMode:false},
   fetch:()=>{requests++;throw Error('Unexpected fetch');},flash:m=>{message=m;}
 });
 assert.equal(requests,0);assert.match(message,/ещё не опубликованы/);
});
test('Historical dialog fetches only the last published round, not the new round',async()=>{
 const start=app.indexOf('async function openManager(managerID){'),end=app.indexOf('async function logout(){',start);
 const part=app.slice(start,end);
 let url='';const modal={hidden:true,innerHTML:''};
 await vm.runInNewContext(part+';openManager("manager-id")',{
  data:{round:{id:3,round_number:3},lastRound:{id:2,round_number:2},leaderboard:[{id:'manager-id',username:'Manager'}]},
  fetch:async u=>{url=u;return {ok:true,json:async()=>({published:true,roster:[],points:0})};},
  flash:m=>{throw Error(m);},$:()=>modal,esc:String,scored:String,historicalPitchHtml:()=>'<div class="pitch"></div>'
 });
 assert.match(url,/&round=2$/);assert.doesNotMatch(url,/round=3/);
 assert.equal(modal.hidden,false);assert.match(modal.innerHTML,/Очки за тур №2/);
});
