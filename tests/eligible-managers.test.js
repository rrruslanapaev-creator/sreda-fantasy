const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {eligibleRosterManagers,publishedData}=require('../api/season');

const entries=(manager,round,players)=>
 players.map(player_id=>({manager_id:manager,round_id:round,player_id}));

test('An account enters League only after saving eight different players',()=>{
 const rows=[
  ...entries('saved-both',1,[1,2,3,4,5,6,7,8]),
  ...entries('saved-both',2,[1,2,3,4,5,6,7,8]),
  ...entries('saved-previous',1,[11,12,13,14,15,16,17,18]),
  ...entries('saved-current',2,[21,22,23,24,25,26,27,28]),
  ...entries('partial',2,[21,22,23,24,25,26,27]),
  ...entries('duplicate-not-full',2,[1,2,3,4,5,6,7,7])
 ];
 const result=eligibleRosterManagers(rows,2);
 assert.deepEqual([...result.historicalIds].sort(),['saved-both','saved-current','saved-previous']);
 assert.deepEqual([...result.currentIds].sort(),['saved-both','saved-current']);
 assert.equal(result.historicalIds.has('unregistered'),false);
});
test('Missing current round does not hide managers with historic complete rosters',()=>{
 const saved=entries('veteran',1,[1,2,3,4,5,6,7,8]);
 const result=eligibleRosterManagers(saved,3);
 assert.deepEqual([...result.historicalIds],['veteran']);
 assert.equal(result.currentIds.size,0);
});
test('Player ownership includes only eight-player current teams (not empty accounts)',async()=>{
 const all=[
  ...entries('active1',2,[1,2,3,4,5,6,7,8]),
  ...entries('active2',2,[1,9,10,11,12,13,14,15]),
  ...entries('historic',1,[1,2,3,4,5,6,7,8]),
  ...entries('partial',2,[1,2,3,4,5,6,7]),
 ];
 const calls=[];
 const client={from(table){
   calls.push(table);
   const values=table==='round_results_publication'?[]:
     table==='roster_entries'?all:undefined;
   if(!values)throw Error('Unexpected table: '+table);
   return {select(){return this;},order(){return this;},
     range(start,end){return Promise.resolve({data:values.slice(start,end+1),error:null});}};
 }};
 const players=[
  {id:1,name:'First',position:'Полевой'},
  {id:2,name:'Second',position:'Полевой'}
 ];
 const result=await publishedData(client,[{id:2,round_number:2}],players,{id:2,round_number:2});
 assert.deepEqual([...result.eligibleManagerIds].sort(),['active1','active2','historic']);
 assert.equal(result.ownershipManagerCount,2);
 const p1=result.seasonPlayers.find(x=>x.player_id===1);
 const p2=result.seasonPlayers.find(x=>x.player_id===2);
 assert.equal(p1.owners,2);
 assert.equal(p1.ownership_percent,100);
 assert.equal(p2.owners,1);
 assert.equal(p2.ownership_percent,50);
 assert.equal(result.lastRound,null);
 assert.deepEqual(calls.sort(),['roster_entries','round_results_publication']);
});
test('The public API filters leaderboard by eligible IDs and uses the same count',()=>{
 const api=fs.readFileSync(path.join(__dirname,'..','api','handler.js'),'utf8');
 assert.match(api,/\.filter\(x=>seasonData\.eligibleManagerIds\.has\(String\(x\.id\)\)\)/);
 assert.match(api,/ownershipManagerCount:seasonData\.ownershipManagerCount/);
 assert.doesNotMatch(api,/\(m\.data\|\|\[\]\)\.length,round\)/);
});
test('Player section and league ownership view use current valid-team denominator',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert.match(app,/const ownershipManagerCount=\(\)=>Number\(data\?\.ownershipManagerCount/);
 assert.match(app,/Владение — доля менеджеров с полным сохранённым составом на текущий тур/);
 assert.match(app,/аккаунты без команды не учитываются/);
});
