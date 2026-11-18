const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const from=app.indexOf('function ownershipDetails(playerID){');
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
  scored:n=>String(n),Number
 };
 return {data,api:vm.runInNewContext(impl+';({ownershipText,popularPlayersHtml,leagueHtml,playerPointsHtml,displayAveragePoints})',ctx)};
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
 const headings=Array.from(h.matchAll(/<th>/g));
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
test('Manager roster ownership uses all registered managers as the denominator',()=>{
 const {api}=make();
 assert.equal(api.ownershipText(2),'Владение: 70,0% (7 из 10)');
 assert.equal(api.ownershipText(4),'Владение: 0,0% (0 из 10)');
 assert.equal(api.ownershipText(999),'Владение: —');
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
 assert.match(part,/ownershipText\(e\.player_id\)/);
});
