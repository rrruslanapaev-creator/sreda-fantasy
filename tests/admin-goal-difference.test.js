const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','admin.js'),'utf8');
const start=source.indexOf('const sfFields=[');
const end=source.indexOf('async function sfLoad(');
if(start<0||end<start)throw Error('Cannot locate admin scoring helpers');
const scoring=source.slice(start,end);

function adminFor(roundNumber){
 return vm.runInNewContext(
  'const sfAdmin={round:{round_number:'+roundNumber+'}};'+scoring+
  ';({fields:sfVisibleFields(),points:sfCalc,defaultStat:sfDefaultStat})'
 );
}
test('Round 2 admin accepts signed difference and hides conceded goals field',()=>{
 const admin=adminFor(2);
 const names=admin.fields.map(x=>x[0]);
 assert.ok(names.includes('goal_difference'));
 assert.ok(!names.includes('goals_conceded'));
 const field=admin.fields.find(x=>x[0]==='goal_difference');
 assert.equal(field[2],-100);
 assert.equal(field[3],100);
 assert.equal(admin.points({attended:true,goal_difference:-6,goals_conceded:99},'Полевой',2),-1);
 assert.equal(admin.defaultStat(12).goal_difference,0);
});
test('Round 1 admin retains old conceded-goals input and formula',()=>{
 const admin=adminFor(1);
 const names=admin.fields.map(x=>x[0]);
 assert.ok(names.includes('goals_conceded'));
 assert.ok(!names.includes('goal_difference'));
 assert.equal(admin.points({attended:true,goal_difference:-30,goals_conceded:6},'Полевой',1),-2);
});
