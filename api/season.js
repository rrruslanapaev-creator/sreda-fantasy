// Published-only fantasy data for season standings and last completed round.
// No unannounced stats are exposed through this module.
const {playerPoints}=require('./results');
const SLOT_ORDER={goalkeeper:0,starter:1,bench1:2,bench2:3};

async function paged(makeQuery){
  const all=[];
  for(let first=0;first<100000;first+=1000){
    const {data,error}=await makeQuery().range(first,first+999);
    if(error)throw error;
    const rows=data||[];
    all.push(...rows);
    if(rows.length<1000)return all;
  }
  throw new Error('Too many league records to load');
}
function rankRows(rows){
  return rows.slice().sort((a,b)=>b.season_points-a.season_points||
    b.ownership_percent-a.ownership_percent||a.name.localeCompare(b.name,'ru'));
}
// A manager qualifies for the league after saving a complete eight-player team
// in any round. For current ownership percentages, count only complete teams
// belonging to the latest round, so empty accounts cannot dilute the figure.
function eligibleRosterManagers(entries,currentRoundId){
 const byManagerRound=new Map();
 for(const e of entries){
   if(e.manager_id==null||e.round_id==null||e.player_id==null)continue;
   const id=String(e.manager_id),round=String(e.round_id);
   const key=JSON.stringify([id,round]);
   if(!byManagerRound.has(key))byManagerRound.set(key,{id,round,players:new Set()});
   byManagerRound.get(key).players.add(String(e.player_id));
 }
 const historicalIds=new Set(),currentIds=new Set();
 for(const r of byManagerRound.values()){
   if(r.players.size!==8)continue;
   historicalIds.add(r.id);
   if(currentRoundId!=null&&r.round===String(currentRoundId))currentIds.add(r.id);
 }
 return {historicalIds,currentIds};
}
function buildSeason(players,stats,publishedIds,ownership,managerCount,roundNumbers=new Map()){
  const pubIds=new Set(publishedIds.map(String));
  const rosterCount=new Map();
  const seen=new Set();
  for(const e of ownership){
    const key=String(e.manager_id)+'|'+String(e.player_id);
    if(seen.has(key))continue;
    seen.add(key);
    const pid=String(e.player_id);
    rosterCount.set(pid,(rosterCount.get(pid)||0)+1);
  }
  const totals=new Map();
  // One denominator for every player: all distinct published league rounds.
  // A missed round contributes zero, and unpublished/test rounds do not count.
  const publishedRoundCount=pubIds.size;
  for(const stat of stats){
    if(!pubIds.has(String(stat.round_id)))continue;
    const pid=String(stat.player_id);
    const player=players.find(p=>String(p.id)===pid);
    if(!player)continue;
    totals.set(pid,(totals.get(pid)||0)+playerPoints(stat,player.position,roundNumbers.get(String(stat.round_id))||1));
  }
  return rankRows(players.map(p=>{
    const owners=rosterCount.get(String(p.id))||0;
    const seasonPoints=totals.get(String(p.id))||0;
    return {
      player_id:p.id,name:p.name,position:p.position,season_points:seasonPoints,
      average_points_per_round:publishedRoundCount?Math.round(seasonPoints/publishedRoundCount*10)/10:null,
      owners,ownership_percent:managerCount>0?Math.round(owners/managerCount*1000)/10:0
    };
  }));
}
function scoredRoster(roster,stats,players,roundNumber=1){
  const playerById=new Map(players.map(p=>[String(p.id),p]));
  const statById=new Map(stats.map(s=>[String(s.player_id),s]));
  const presence=e=>statById.get(String(e.player_id))?.attended===true;
  const playing=roster.filter(e=>(e.slot==='goalkeeper'||e.slot==='starter')&&presence(e));
  const presentOutfield=playing.filter(e=>e.slot==='starter').length;
  const bench=roster.filter(e=>(e.slot==='bench1'||e.slot==='bench2')&&presence(e))
    .sort((a,b)=>(SLOT_ORDER[a.slot]??99)-(SLOT_ORDER[b.slot]??99))
    .slice(0,Math.max(0,5-presentOutfield));
  const selected=new Set([...playing,...bench].map(e=>String(e.player_id)));
  const captain=roster.find(e=>e.is_captain&&selected.has(String(e.player_id)));
  const vice=!captain?roster.find(e=>e.is_vice_captain&&selected.has(String(e.player_id))):null;
  const doubledId=String((captain||vice)?.player_id??'');
  return roster.map(e=>{
    const id=String(e.player_id);
    const stat=statById.get(id);
    const player=playerById.get(id);
    const raw=player?playerPoints(stat,player.position,roundNumber):0;
    const counted=selected.has(id);
    const multiplier=counted&&id===doubledId?2:1;
    return {
      player_id:e.player_id,slot:e.slot,is_captain:!!e.is_captain,
      is_vice_captain:!!e.is_vice_captain,
      attended:presence(e),counted,substituted:counted&&(e.slot==='bench1'||e.slot==='bench2'),
      raw_points:raw,multiplier,points:counted?raw*multiplier:0
    };
  }).sort((a,b)=>(SLOT_ORDER[a.slot]??99)-(SLOT_ORDER[b.slot]??99));
}
async function publishedData(client,rounds,players,currentRound){
  const published=await paged(()=>client.from('round_results_publication')
    .select('round_id').order('round_id',{ascending:true}));
  const publishedIds=published.map(p=>p.round_id);
  const publishedSet=new Set(publishedIds.map(String));
  const lastRound=rounds.find(r=>publishedSet.has(String(r.id)))||null;

  // Use saved rosters rather than registered accounts to identify actual
  // participants. Only aggregate player ownership (never another manager's
  // private lineup) is returned to the browser.
  const [stats,rosterEntries]=await Promise.all([
    publishedIds.length?paged(()=>client.from('player_round_stats')
      .select('round_id,player_id,attended,goals,assists,clean_sheets,penalty_saves,penalty_misses,own_goals,goals_conceded,goal_difference,team_wins,champion')
      .in('round_id',publishedIds).order('round_id',{ascending:true}).order('player_id',{ascending:true})):
      Promise.resolve([]),
    paged(()=>client.from('roster_entries')
      .select('manager_id,round_id,player_id').order('id',{ascending:true}))
  ]);

  const {historicalIds,currentIds}=eligibleRosterManagers(rosterEntries,currentRound?.id);
  const ownership=currentRound?rosterEntries.filter(e=>
    String(e.round_id)===String(currentRound.id)&&currentIds.has(String(e.manager_id))):[];
  const lastStats=lastRound?stats.filter(s=>String(s.round_id)===String(lastRound.id)):[];
  const roundNumbers=new Map(rounds.map(r=>[String(r.id),Number(r.round_number)]));
  return {
    lastRound,
    lastStats,
    eligibleManagerIds:historicalIds,
    ownershipManagerCount:currentIds.size,
    seasonPlayers:buildSeason(players,stats,publishedIds,ownership,currentIds.size,roundNumbers)
  };
}
module.exports={paged,eligibleRosterManagers,buildSeason,scoredRoster,publishedData};
