const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSeason,scoredRoster}=require('../api/season');

const roster=[
 {player_id:1,slot:'goalkeeper',is_captain:false,is_vice_captain:false},
 {player_id:2,slot:'starter',is_captain:true,is_vice_captain:false},
 {player_id:3,slot:'starter',is_captain:false,is_vice_captain:true},
 {player_id:4,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:5,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:6,slot:'starter',is_captain:false,is_vice_captain:false},
 {player_id:7,slot:'bench1',is_captain:false,is_vice_captain:false},
 {player_id:8,slot:'bench2',is_captain:false,is_vice_captain:false}
];
const players=roster.map((r,i)=>({id:r.player_id,name:'Player '+r.player_id,position:i===0?'Вратарь':'Полевой'}));
const stats=roster.map(r=>({player_id:r.player_id,attended:true,goals:0,assists:0,clean_sheets:0,goals_conceded:0}));

test('Every starter scores; unused bench scores zero, even when attended',()=>{
 const rows=scoredRoster(roster,stats,players);
 assert.deepEqual(rows.map(r=>r.points),[1,2,1,1,1,1,0,0]);
 assert.equal(rows.reduce((s,e)=>s+e.points,0),7);
 assert.equal(rows[6].raw_points,1);
 assert.equal(rows[6].counted,false);
 assert.equal(rows[7].points,0);
});
test('Absent captain gives vice ×2, and bench1 replaces absent starter',()=>{
 const withAbsent=stats.map(s=>({
   ...s,attended:s.player_id!==2,
   goals:s.player_id===7?2:0
 }));
 const rows=scoredRoster(roster,withAbsent,players);
 const byId=new Map(rows.map(x=>[x.player_id,x]));
 assert.equal(byId.get(2).points,0);
 assert.equal(byId.get(3).points,2);
 assert.equal(byId.get(7).points,11);
 assert.equal(byId.get(7).substituted,true);
 assert.equal(byId.get(8).points,0);
 assert.equal(rows.reduce((s,r)=>s+r.points,0),17);
});
test('Missing goalkeeper cannot be replaced; negative captain scores double',()=>{
 const withAbsent=stats.map(s=>({
  ...s,attended:s.player_id!==1,goals_conceded:s.player_id===2?6:0
 }));
 const rows=scoredRoster(roster,withAbsent,players);
 const byId=new Map(rows.map(x=>[x.player_id,x]));
 assert.equal(byId.get(1).points,0);
 assert.equal(byId.get(2).raw_points,-2);
 assert.equal(byId.get(2).points,-4);
 assert.equal(byId.get(3).points,1);
});
test('Two absent field starters activate both available bench players in priority order',()=>{
 const withAbsent=stats.map(s=>({...s,attended:![4,6].includes(s.player_id)}));
 const rows=scoredRoster(roster,withAbsent,players);
 assert.equal(rows.find(x=>x.player_id===7).points,1);
 assert.equal(rows.find(x=>x.player_id===8).points,1);
 assert.equal(rows.reduce((s,x)=>s+x.points,0),7);
});
test('Season totals sum only published rounds and ownership uses registered accounts',()=>{
 const p=[{id:1,name:'Alpha',position:'Полевой'},
   {id:2,name:'Beta',position:'Полевой'}, {id:3,name:'Gamma',position:'Вратарь'}];
 const s=[
  {round_id:1,player_id:1,attended:true,goals:1},
  {round_id:2,player_id:1,attended:true,assists:2},
  {round_id:3,player_id:1,attended:true,goals:10},
  {round_id:1,player_id:2,attended:false,goals:4},
  {round_id:1,player_id:3,attended:true,clean_sheets:1}
 ];
 const ownership=[
  {manager_id:'a',player_id:1},{manager_id:'a',player_id:1},
  {manager_id:'b',player_id:1},{manager_id:'c',player_id:2}
 ];
 const results=buildSeason(p,s,[1,2],ownership,4);
 const byId=new Map(results.map(x=>[x.player_id,x]));
 assert.equal(byId.get(1).season_points,13);
 assert.equal(byId.get(1).ownership_percent,50);
 assert.equal(byId.get(1).owners,2);
 assert.equal(byId.get(2).season_points,0);
 assert.equal(byId.get(2).ownership_percent,25);
 assert.equal(byId.get(3).season_points,4);
 assert.equal(byId.get(3).ownership_percent,0);
});
test('Empty league produces 0% ownership rather than NaN',()=>{
 const rows=buildSeason([{id:1,name:'A',position:'Полевой'}],[],[],[],0);
 assert.equal(rows[0].ownership_percent,0);
 assert.equal(rows[0].season_points,0);
});
