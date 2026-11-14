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

test('round 2 onwards: every complete minus-three goal difference is minus one',()=>{
 for(const position of ['Вратарь','Полевой']){
  for(const [difference,expected] of [[9,1],[0,1],[-1,1],[-2,1],[-3,0],[-4,0],[-5,0],[-6,-1],[-7,-1],[-8,-1],[-9,-2]]){
   assert.equal(playerPoints({attended:true,goal_difference:difference,goals_conceded:100},position,2),expected,
    'Incorrect result for team goal difference '+difference+' / '+position);
  }
 }
});
test('the new penalty ignores goals conceded and is not applied to absent players',()=>{
 assert.equal(playerPoints({attended:true,goals_conceded:12,goal_difference:6},'Полевой',2),1);
 assert.equal(playerPoints({attended:true,goals_conceded:0,goal_difference:-6},'Полевой',2),-1);
 assert.equal(playerPoints({attended:false,goal_difference:-30},'Полевой',2),0);
});
test('round 1 remains historically unchanged even if goal_difference is supplied',()=>{
 const sample={attended:true,goals:2,assists:1,clean_sheets:3,champion:true,goals_conceded:5,goal_difference:-30};
 assert.equal(playerPoints(sample,'Полевой',1),17);
 assert.equal(playerPoints(sample,'Полевой'),17);
 assert.equal(playerPoints(sample,'Полевой',2),9);
});
