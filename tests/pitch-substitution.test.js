const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function slice(from,to){
 const a=app.indexOf(from),b=app.indexOf(to,a+from.length);
 if(a<0||b<=a)throw Error('Frontend fragment missing: '+from);
 return app.slice(a,b);
}
const assign=slice('function assignFlags(){','function addPlayer(');
const choose=slice('function movePlayer(id){','async function saveTeam(){');
const display=slice('function ensureDisplaySlots(){','function marketHtml(){');
const fields=()=>[
 {player_id:1,slot:'goalkeeper',is_captain:false,is_vice_captain:false},
 {player_id:2,slot:'starter',is_captain:true,is_vice_captain:false},
 {player_id:3,slot:'starter',is_captain:false,is_vice_captain:true},
 {player_id:4,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:5,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:6,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:7,slot:'bench1',is_captain:false,is_vice_captain:false},
 {player_id:8,slot:'bench2',is_captain:false,is_vice_captain:false}
];
function setup(isLocked=false){
 const draft=fields();
 const context={
  draft,selectedSwapId:null,swapNotice:'',
  locked:()=>isLocked,render:()=>{},
  esc:x=>String(x),byId:id=>({id,name:'Игрок '+id,position:id===1?'Вратарь':'Полевой',price:5}),
  latestEntry:()=>null,unusedBench:()=>false,
  scored:n=>String(n),displayedPlayerPoints:()=>0,cash:n=>String(n)
 };
 const getters=vm.runInNewContext(assign+choose+display+
  ';({choose:movePlayer,guide:swapGuideHtml,layout:ensureDisplaySlots,chip,selected:()=>selectedSwapId,notice:()=>swapNotice})',context);
 getters.layout();
 return {draft,...getters};
}
test('Selecting one starter highlights it, then the chosen bench player replaces the exact pitch position',()=>{
 const ui=setup();
 ui.choose(2);
 assert.equal(ui.selected(),2);
 assert.equal(ui.draft.find(e=>e.player_id===2).slot,'starter');
 assert.match(ui.chip('starter:0','Основа'),/chip-swap-selected/);
 assert.match(ui.chip('bench1','Запас 1'),/chip-swap-target/);
 assert.match(ui.guide(),/Выбран Игрок 2/);
 ui.choose(7);
 assert.equal(ui.selected(),null);
 assert.equal(ui.draft[1].player_id,7);
 assert.equal(ui.draft[1].slot,'starter');
 assert.equal(ui.draft[6].player_id,2);
 assert.equal(ui.draft[6].slot,'bench1');
 assert.equal(ui.draft[7].player_id,8);
 assert.equal(ui.draft.filter(x=>x.slot==='starter').length,5);
 assert.equal(ui.draft.find(x=>x.player_id===7).is_captain,true);
 assert.equal(ui.draft.find(x=>x.player_id===2).is_captain,false);
 ui.layout();
 assert.match(ui.chip('starter:0','Основа'),/Игрок 7/);
 assert.match(ui.chip('bench1','Запас 1'),/Игрок 2/);
 assert.match(ui.guide(),/Сохранить состав/);
});
test('Repeated tap cancels selection; tapping another starter changes selection',()=>{
 const ui=setup();
 ui.choose(2);
 ui.choose(2);
 assert.equal(ui.selected(),null);
 ui.choose(2);
 ui.choose(3);
 assert.equal(ui.selected(),3);
 ui.choose(8);
 assert.equal(ui.draft[2].player_id,8);
 assert.equal(ui.draft[7].player_id,3);
 assert.equal(ui.draft.find(e=>e.player_id===8).is_vice_captain,true);
 assert.equal(ui.draft.find(e=>e.player_id===2).is_captain,true);
});
test('Clicking bench first changes nothing; goalkeeper cannot be swapped',()=>{
 const ui=setup();
 ui.choose(7);
 assert.equal(ui.selected(),null);
 assert.match(ui.guide(),/Сначала выбери/);
 ui.choose(1);
 assert.equal(ui.selected(),null);
 assert.equal(ui.draft[0].slot,'goalkeeper');
 assert.doesNotMatch(ui.chip('goalkeeper','Вратарь'),/data-action="move"/);
 assert.match(ui.chip('bench2','Запас 2'),/data-action="move"/);
});
test('After deadline click selection and substitution are blocked',()=>{
 const ui=setup(true);
 ui.choose(2);
 ui.choose(7);
 assert.equal(ui.selected(),null);
 assert.equal(ui.draft[1].player_id,2);
 assert.doesNotMatch(ui.chip('starter:0','Основа'),/data-action="move"/);
});
test('Substitution preserves the team budget and the original eight players',()=>{
 const ui=setup();
 const idsBefore=ui.draft.map(e=>e.player_id).sort((a,b)=>a-b);
 ui.choose(5);ui.choose(8);
 assert.deepEqual(ui.draft.map(e=>e.player_id).sort((a,b)=>a-b),idsBefore);
 assert.equal(ui.draft.length,8);
 assert.equal(ui.draft.filter(e=>e.is_captain).length,1);
 assert.equal(ui.draft.filter(e=>e.is_vice_captain).length,1);
});
