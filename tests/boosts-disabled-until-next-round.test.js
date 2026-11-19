const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const handler=fs.readFileSync(path.join(root,'api','handler.js'),'utf8');
const from=app.indexOf('const futureBoosts=[');
const until=app.indexOf('function teamHtml(){',from);
if(from<0||until<=from)throw Error('Boost design is missing');
const panel=vm.runInNewContext(app.slice(from,until)+';boostPanelHtml()',{
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;')
});
test('All four season boost designs are visible but disabled in every environment',()=>{
 for(const name of ['Вайлдкард','Фри-хит','Тройной капитан','Бенч-буст'])
  assert.ok(panel.includes(name),name+' was not shown');
 assert.equal((panel.match(/class="boost-card"/g)||[]).length,4);
 assert.equal((panel.match(/<button [^>]* disabled /g)||[]).length,4);
 assert.equal((panel.match(/aria-disabled="true"/g)||[]).length,4);
 assert.doesNotMatch(panel,/data-action="boost"|data-boost=/);
 assert.match(panel,/В этом туре бусты не работают/);
});
test('No boost click handler or boost payload exists in the active frontend',()=>{
 assert.doesNotMatch(app,/function selectBoost\(/);
 assert.doesNotMatch(app,/action==='boost'/);
 assert.doesNotMatch(app,/api\('save',\{roster:draft,boost:/);
 assert.match(app,/api\('save',\{roster:draft\}\)/);
});
test('Server uses the existing roster RPC and refuses forged boost requests',()=>{
 assert.match(handler,/if\(body\.boost!=null\)return send\(res,400,/);
 assert.match(handler,/client\.rpc\('save_fantasy_roster',\{p_manager:user\.id,p_entries:body\.roster\}\)/);
 assert.doesNotMatch(handler,/sf_save_boosted_roster|manager_boosts|boostHistory/);
});
test('Boost migration is staged in a separate feature branch, not the redesign',()=>{
 assert.equal(fs.existsSync(path.join(root,'supabase','009_season_boosts.sql')),false);
 assert.equal(fs.existsSync(path.join(root,'tests','sql_season_boosts_regression.sql')),false);
 const sql=fs.readFileSync(path.join(root,'.github','workflows','scoring.yml'),'utf8');
 assert.doesNotMatch(sql,/009_season_boosts/);
});
