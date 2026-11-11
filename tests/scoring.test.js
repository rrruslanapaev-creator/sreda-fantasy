const test=require('node:test');
const assert=require('node:assert/strict');
const {playerPoints}=require('../api/results');
test('absent player has zero points, including no conceded-goals penalty',()=>{
 assert.equal(playerPoints({attended:false,goals:3,goals_conceded:8},'Полевой'),0);
});
test('one penalty point for every TWO conceded, for field players and goalkeepers',()=>{
 for(const position of ['Вратарь','Полевой']){
  assert.equal(playerPoints({attended:true,goals_conceded:0},position),1);
  assert.equal(playerPoints({attended:true,goals_conceded:1},position),1);
  assert.equal(playerPoints({attended:true,goals_conceded:2},position),0);
  assert.equal(playerPoints({attended:true,goals_conceded:3},position),0);
  assert.equal(playerPoints({attended:true,goals_conceded:4},position),-1);
  assert.equal(playerPoints({attended:true,goals_conceded:7},position),-2);
 }
});
test('field player: goals +5, assist +3, clean match +1, evening champion +2',()=>{
 assert.equal(playerPoints({attended:true,goals:2,assists:1,clean_sheets:3,champion:true,goals_conceded:5},'Полевой'),17);
});
test('goalkeeper goal +10, clean match +3, penalty save +5',()=>{
 assert.equal(playerPoints({attended:true,goals:1,clean_sheets:2,penalty_saves:1,goals_conceded:7},'Вратарь'),19);
});
test('missed penalties and own goals cost two each',()=>{
 assert.equal(playerPoints({attended:true,penalty_misses:2,own_goals:1},'Полевой'),-5);
});
