// Administrative market operations; user identity comes only from the server session.
function validPrice(price){
  const p=Number(price);
  if(!Number.isFinite(p)||p<0.1||p>50||Math.abs(Math.round(p*10)-p*10)>1e-8)
    throw Object.assign(new Error('Цена должна быть от 0.1 до 50.0 с шагом 0.1'),{status:400});
  return p;
}
async function marketPlayers(client){
  const {data,error}=await client.from('players')
    .select('id,name,position,price,active')
    .order('name',{ascending:true});
  if(error)throw error;
  return {players:data||[]};
}
async function addPlayer(client,user,body){
  const name=String(body.name||'').trim();
  const position=String(body.position||'');
  const price=validPrice(body.price);
  if(name.length<2||name.length>60)
    throw Object.assign(new Error('Имя футболиста должно содержать 2–60 символов'),{status:400});
  if(!['Вратарь','Полевой'].includes(position))
    throw Object.assign(new Error('Выбери позицию футболиста'),{status:400});
  const {data,error}=await client.rpc('sf_add_market_player',{
    p_admin:user.id,p_name:name,p_position:position,p_price:price
  });
  if(error)throw Object.assign(new Error(error.message),{status:400});
  return {ok:true,player_id:data};
}
async function updatePrice(client,user,body){
  const id=Number(body.player_id),price=validPrice(body.price);
  if(!Number.isSafeInteger(id)||id<1)
    throw Object.assign(new Error('Футболист не найден'),{status:400});
  const {data,error}=await client.rpc('sf_update_market_price',{
    p_admin:user.id,p_player:id,p_price:price
  });
  if(error)throw Object.assign(new Error(error.message),{status:400});
  return {ok:data===true};
}
module.exports={validPrice,marketPlayers,addPlayer,updatePrice};
