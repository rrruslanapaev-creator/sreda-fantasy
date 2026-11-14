const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('const budgetLimit=');
const end=source.indexOf('const scored=');
if(start<0||end<=start)throw Error('Budget UI helpers not found in app.js');
const snippet=source.slice(start,end);
function setup(saved,draft,prices,locked=false){
 const ctx={
  data:{user:{id:'manager-1'},roster:saved,locked},
  draft,byId:id=>({price:prices[id]}),
  cash:n=>Number(n).toFixed(1)
 };
 return vm.runInNewContext(snippet+';({budgetAlertHtml,rosterCost})',ctx);
}
const id=n=>({player_id:n});
test('Shows a strong warning when a previously valid saved squad is repriced over 50',()=>{
 const rows=[id(1),id(2)];
 const ui=setup(rows,rows,{1:30.5,2:20});
 const warning=ui.budgetAlertHtml();
 assert.match(warning,/role="alert"/);
 assert.match(warning,/Стоимость сохранённой команды/);
 assert.match(warning,/50\.5/);
 assert.match(warning,/превышение <strong>0\.5/);
 assert.match(warning,/Замени одного или нескольких/);
});
test('Warning persists until a corrected draft is actually saved',()=>{
 const saved=[id(1),id(2)];
 const edited=[id(1),id(3)];
 const ui=setup(saved,edited,{1:30.5,2:20,3:18});
 const warning=ui.budgetAlertHtml();
 assert.match(warning,/Стоимость сохранённой команды/);
 assert.match(warning,/Нажми «Сохранить состав»/);
 assert.equal(ui.rosterCost(edited),48.5);
});
test('Corrected and saved roster is not warned',()=>{
 const rows=[id(1),id(3)];
 const ui=setup(rows,rows,{1:30.5,2:20,3:18});
 assert.equal(ui.budgetAlertHtml(),'');
});
test('Warnings also show when an unsaved draft exceeds the cap',()=>{
 const ui=setup([id(1),id(3)],[id(1),id(2)],{1:30.5,2:20,3:18});
 assert.match(ui.budgetAlertHtml(),/Текущий выбранный состав стоит/);
});
test('After the deadline the warning does not pretend edits can be saved',()=>{
 const rows=[id(1),id(2)];
 const ui=setup(rows,rows,{1:30.5,2:20},true);
 assert.match(ui.budgetAlertHtml(),/Дедлайн уже прошёл/);
 assert.doesNotMatch(ui.budgetAlertHtml(),/Замени одного/);
});
