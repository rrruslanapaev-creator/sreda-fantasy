// Server-side results API. Access checked again inside SQL functions.
const FIELDS=['goals','assists','clean_sheets','penalty_saves','penalty_misses','own_goals','goals_conceded'];
function playerPoints(stat,position){
  if(!stat?.attended)return 0;
  const n=k=>Number(stat[k]||0);
  return 1+n('goals')*(position==='Вратарь'?10:5)+n('assists')*3+
    n('clean_sheets')*(position==='Вратарь'?3:1)+n('penalty_saves')*5-
    n('penalty_misses')*2-n('own_goals')*2-Math.floor(n('goals_conceded')/2)+
    (stat.champion?2:0);
}
function roundId(value){
  const x=Number(value);
  if(!Number.isSafeInteger(x)||x<1)throw Object.assign(new Error('Неверный номер тура'),{status:400});
  return x;
}
async function adminResults(client,requested){
  const [rr,pp]=await Promise.all([
    client.from('rounds').select('id,round_number,deadline_at,status').order('round_number',{ascending:false}),
    client.from('players').select('id,name,position,active').order('name')
  ]);
  if(rr.error||pp.error)throw rr.error||pp.error;
  const rounds=rr.data||[],players=pp.data||[];
  const round=(!requested?rounds[0]:rounds.find(r=>Number(r.id)===roundId(requested)))||null;
  if(!round)throw Object.assign(new Error('Тур не найден'),{status:404});
  const [ss,pub]=await Promise.all([
    client.from('player_round_stats').select('*').eq('round_id',round.id),
    client.from('round_results_publication').select('published_at').eq('round_id',round.id).maybeSingle()
  ]);
  if(ss.error||pub.error)throw ss.error||pub.error;
  return {rounds,round,players,stats:ss.data||[],published_at:pub.data?.published_at||null};
}
async function saveResults(client,user,body){
  const rid=roundId(body.round_id);
  if(!Array.isArray(body.stats)||body.stats.length>1000)
    throw Object.assign(new Error('Неверный список статистики'),{status:400});
  const {data,error}=await client.rpc('sf_save_results',{
    p_admin:user.id,p_round:rid,p_stats:body.stats
  });
  if(error)throw Object.assign(new Error(error.message),{status:400});
  return {ok:data===true};
}
async function publishResults(client,user,body){
  const rid=roundId(body.round_id);
  const {data,error}=await client.rpc('sf_publish_results',{p_admin:user.id,p_round:rid});
  if(error)throw Object.assign(new Error(error.message),{status:400});
  return {ok:true,managers:Number(data||0)};
}
async function publishedScores(client,round,players){
  if(!round)return {published:false,playerScores:[]};
  const {data:pub,error:pe}=await client.from('round_results_publication')
    .select('published_at').eq('round_id',round.id).maybeSingle();
  if(pe){
    // Keep the existing site readable while migration 003 is being installed.
    if(['42P01','PGRST205'].includes(pe.code))return {published:false,playerScores:[]};
    throw pe;
  }
  if(!pub)return {published:false,playerScores:[]};
  const {data:stats,error:se}=await client.from('player_round_stats')
    .select('player_id,attended,goals,assists,clean_sheets,penalty_saves,penalty_misses,own_goals,goals_conceded,champion')
    .eq('round_id',round.id);
  if(se)throw se;
  const byId=new Map(players.map(p=>[String(p.id),p]));
  return {published:true,playerScores:(stats||[]).filter(s=>s.attended).map(s=>({
    player_id:s.player_id,points:playerPoints(s,byId.get(String(s.player_id))?.position)
  })).sort((a,b)=>b.points-a.points)};
}
module.exports={adminResults,saveResults,publishResults,publishedScores,playerPoints,FIELDS};
