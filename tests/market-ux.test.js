const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const market=app.slice(app.indexOf('function marketRows('),app.indexOf('// Source of truth:'));
const render=app.slice(app.indexOf('function render(){'),app.indexOf('function openLogin(){'));
test('Market lists owned players first without mutating API player order',()=>{
 const players=[{id:1,name:'Outside A',price:8},{id:2,name:'Owned A',price:6},{id:3,name:'Outside B',price:5},{id:4,name:'Owned B',price:3}];
 const result=vm.runInNewContext(market+';marketRows(players)',{
  players,draft:[{player_id:2},{player_id:4}],esc:String,pos:()=> 'Полевой',cash:String,locked:()=>false,roomFor:()=>true
 });
 const names=['Owned A','Owned B','Outside A','Outside B'].map(n=>result.indexOf(n));
 assert.ok(names.every((v,i)=>v>=0&&(i===0||v>names[i-1])));
 assert.equal((result.match(/market-owned/g)||[]).length,2);
 assert.equal(players[0].id,1);
});
test('Render preserves both market-list and page scrolling on squad edits',()=>{
 let list={scrollTop:480};let pageScroll;
 const common={textContent:'',disabled:false,nextElementSibling:{},closest:()=>({classList:{toggle(){}}})};
 const content={set innerHTML(v){list={scrollTop:0};}};
 vm.runInNewContext(render+';render()',{
  data:{user:{},round:null,transfers:0},tab:'market',draft:[],
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  $:id=>id==='market-list'?list:id==='content'?content:common,
  window:{scrollY:250,scrollX:0,scrollTo:options=>{pageScroll=options;}},
  ensureDisplaySlots:()=>{},cash:String,budgetLimit:50,used:()=>0,displayDeadlineTime:()=> '—',marketHtml:()=>'<div id="market-list"></div>'
 });
 assert.equal(list.scrollTop,480);
 assert.equal(pageScroll.top,250);
});
