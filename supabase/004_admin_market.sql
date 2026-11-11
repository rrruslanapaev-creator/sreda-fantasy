-- Sreda Fantasy · migration 004: admin market management and price snapshots.
-- Run after 002 (online features) and 003 (results).
-- Does not reset rosters, members, results or transfers.
BEGIN;

-- Remember the price paid when a manager selected a player.
-- Existing rosters are backfilled at the current price (historic prices were not stored).
ALTER TABLE public.roster_entries
  ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2);
UPDATE public.roster_entries e
SET purchase_price=p.price
FROM public.players p
WHERE p.id=e.player_id AND e.purchase_price IS NULL;

CREATE OR REPLACE FUNCTION public.sf_add_market_player(
  p_admin uuid, p_name text, p_position text, p_price numeric
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE clean_name text; new_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.managers WHERE id=p_admin AND is_admin=true)
    THEN RAISE EXCEPTION 'Нет прав администратора'; END IF;
  clean_name=pg_catalog.btrim(COALESCE(p_name,''));
  IF pg_catalog.char_length(clean_name) NOT BETWEEN 2 AND 60
    THEN RAISE EXCEPTION 'Имя футболиста должно содержать 2–60 символов'; END IF;
  IF p_position IS NULL OR p_position NOT IN ('Вратарь','Полевой')
    THEN RAISE EXCEPTION 'Укажи позицию: Вратарь или Полевой'; END IF;
  IF p_price IS NULL OR p_price<=0 OR p_price>50 OR p_price*10<>pg_catalog.trunc(p_price*10)
    THEN RAISE EXCEPTION 'Цена должна быть от 0.1 до 50.0 с шагом 0.1'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sf-market-players',0));
  IF EXISTS (SELECT 1 FROM public.players
    WHERE pg_catalog.lower(pg_catalog.btrim(name))=pg_catalog.lower(clean_name)) THEN
    RAISE EXCEPTION 'Футболист с таким именем уже существует'; END IF;
  INSERT INTO public.players(name,position,price,active)
  VALUES (clean_name,p_position,p_price,true)
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.sf_add_market_player(uuid,text,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_add_market_player(uuid,text,text,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.sf_update_market_price(
  p_admin uuid, p_player bigint, p_price numeric
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.managers WHERE id=p_admin AND is_admin=true)
    THEN RAISE EXCEPTION 'Нет прав администратора'; END IF;
  IF p_price IS NULL OR p_price<=0 OR p_price>50 OR p_price*10<>pg_catalog.trunc(p_price*10)
    THEN RAISE EXCEPTION 'Цена должна быть от 0.1 до 50.0 с шагом 0.1'; END IF;
  UPDATE public.players SET price=p_price WHERE id=p_player;
  IF NOT FOUND THEN RAISE EXCEPTION 'Футболист не найден'; END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.sf_update_market_price(uuid,bigint,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_update_market_price(uuid,bigint,numeric) TO service_role;

-- Preserve price paid for players kept in the current or immediately previous
-- round. New acquisitions use the latest market price.
CREATE OR REPLACE FUNCTION public.save_fantasy_roster(p_manager uuid, p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_round public.rounds%ROWTYPE;
  previous_round bigint;
  keeper_count integer; starter_count integer; bench1_count integer; bench2_count integer;
  captain_count integer; vice_count integer; unique_count integer; invalid_count integer;
  overlap_count integer;
  budget numeric; previous_ids bigint[]; chosen_ids bigint[]; chosen_prices jsonb;
  spent integer; additions integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_manager::text,0));
  SELECT * INTO current_round FROM public.rounds ORDER BY round_number DESC LIMIT 1;
  IF current_round.id IS NULL THEN RAISE EXCEPTION 'Администратор ещё не создал тур.'; END IF;
  IF pg_catalog.now() >= current_round.deadline_at THEN RAISE EXCEPTION 'Дедлайн уже прошёл.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.managers WHERE id=p_manager) THEN
    RAISE EXCEPTION 'Менеджер не найден.'; END IF;
  IF pg_catalog.jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(p_entries) <> 8 THEN
    RAISE EXCEPTION 'Нужно ровно 8 игроков.'; END IF;

  WITH chosen AS (
    SELECT (v->>'player_id')::bigint AS id, v->>'slot' AS slot,
           COALESCE((v->>'is_captain')::boolean,false) AS captain,
           COALESCE((v->>'is_vice_captain')::boolean,false) AS vice
    FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v)
  ) SELECT COUNT(DISTINCT id),
      COUNT(*) FILTER(WHERE slot='goalkeeper'), COUNT(*) FILTER(WHERE slot='starter'),
      COUNT(*) FILTER(WHERE slot='bench1'), COUNT(*) FILTER(WHERE slot='bench2'),
      COUNT(*) FILTER(WHERE captain AND NOT vice AND slot IN ('goalkeeper','starter')),
      COUNT(*) FILTER(WHERE vice AND NOT captain AND slot IN ('goalkeeper','starter')),
      COUNT(*) FILTER(WHERE (captain OR vice) AND slot NOT IN ('goalkeeper','starter')),
      COUNT(*) FILTER(WHERE captain AND vice)
    INTO unique_count,keeper_count,starter_count,bench1_count,bench2_count,
      captain_count,vice_count,invalid_count,overlap_count FROM chosen;
  IF unique_count<>8 OR keeper_count<>1 OR starter_count<>5 OR bench1_count<>1 OR
     bench2_count<>1 OR captain_count<>1 OR vice_count<>1 OR invalid_count<>0
     OR overlap_count<>0 THEN
    RAISE EXCEPTION 'Нужны 1 вратарь, 5 полевых, 2 запасных, капитан и вице-капитан из основы.';
  END IF;

  SELECT id INTO previous_round FROM public.rounds
  WHERE round_number<current_round.round_number ORDER BY round_number DESC LIMIT 1;

  WITH chosen AS (
    SELECT (v->>'player_id')::bigint AS id,v->>'slot' AS slot
    FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v)
  ) SELECT
      COUNT(*) FILTER(WHERE p.id IS NULL OR NOT p.active OR
        (chosen.slot='goalkeeper')<>(p.position='Вратарь')),
      COALESCE(SUM(COALESCE(here.purchase_price,prev.purchase_price,p.price)),0),
      pg_catalog.jsonb_object_agg(chosen.id::text,COALESCE(here.purchase_price,prev.purchase_price,p.price))
    INTO invalid_count,budget,chosen_prices
    FROM chosen
    LEFT JOIN public.players p ON p.id=chosen.id
    LEFT JOIN public.roster_entries here ON here.round_id=current_round.id
      AND here.manager_id=p_manager AND here.player_id=chosen.id
    LEFT JOIN public.roster_entries prev ON prev.round_id=previous_round
      AND prev.manager_id=p_manager AND prev.player_id=chosen.id;
  IF invalid_count<>0 OR budget>50 THEN
    RAISE EXCEPTION 'Некорректные позиции игроков или превышен бюджет 50.'; END IF;

  SELECT pg_catalog.array_agg(player_id ORDER BY player_id) INTO previous_ids
  FROM public.roster_entries WHERE round_id=current_round.id AND manager_id=p_manager;
  IF previous_ids IS NULL AND previous_round IS NOT NULL THEN
    SELECT pg_catalog.array_agg(player_id ORDER BY player_id) INTO previous_ids
    FROM public.roster_entries WHERE round_id=previous_round AND manager_id=p_manager;
  END IF;
  SELECT pg_catalog.array_agg((v->>'player_id')::bigint ORDER BY (v->>'player_id')::bigint)
    INTO chosen_ids FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v);
  SELECT COUNT(*) INTO additions FROM pg_catalog.unnest(chosen_ids) AS new_id
  WHERE previous_ids IS NOT NULL AND NOT (new_id=ANY(previous_ids));
  SELECT COUNT(*) INTO spent FROM public.transfers
  WHERE round_id=current_round.id AND manager_id=p_manager;
  IF spent+additions>2 THEN
    RAISE EXCEPTION 'В этом туре разрешены только 2 трансфера.'; END IF;

  IF additions>0 THEN
    INSERT INTO public.transfers(round_id,manager_id,player_out_id,player_in_id)
    SELECT current_round.id,p_manager,o.id,n.id FROM
      (SELECT id,ROW_NUMBER() OVER(ORDER BY id) AS rn FROM (
        SELECT pg_catalog.unnest(previous_ids) AS id EXCEPT
        SELECT pg_catalog.unnest(chosen_ids) AS id
      ) removed) o
      JOIN (SELECT id,ROW_NUMBER() OVER(ORDER BY id) AS rn FROM (
        SELECT pg_catalog.unnest(chosen_ids) AS id EXCEPT
        SELECT pg_catalog.unnest(previous_ids) AS id
      ) added) n ON o.rn=n.rn;
  END IF;
  DELETE FROM public.roster_entries
  WHERE round_id=current_round.id AND manager_id=p_manager;
  INSERT INTO public.roster_entries
    (round_id,manager_id,player_id,slot,is_captain,is_vice_captain,purchase_price)
  SELECT current_round.id,p_manager,(v->>'player_id')::bigint,v->>'slot',
         COALESCE((v->>'is_captain')::boolean,false),
         COALESCE((v->>'is_vice_captain')::boolean,false),
         (chosen_prices->>(v->>'player_id'))::numeric
  FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v);
  RETURN spent+additions;
END; $$;
REVOKE ALL ON FUNCTION public.save_fantasy_roster(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_fantasy_roster(uuid,jsonb) TO service_role;

COMMIT;
