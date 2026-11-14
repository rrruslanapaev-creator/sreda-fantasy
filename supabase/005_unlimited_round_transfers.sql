-- Sreda Fantasy | unlimited transfers for explicitly designated rounds.
-- Add only the round-scoped option. Does not touch any existing rounds/rosters/scores.
-- Round #2 activation is a separate transactional operation after deploying the frontend.
BEGIN;
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS unlimited_transfers boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.rounds.unlimited_transfers IS
  'When true, managers may rebuild the full eight-player squad freely until this round deadline.';
CREATE OR REPLACE FUNCTION public.save_fantasy_roster(p_manager uuid, p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_round public.rounds%ROWTYPE;
  previous_round bigint;
  keeper_count integer; starter_count integer; bench1_count integer; bench2_count integer;
  captain_count integer; vice_count integer; unique_count integer; invalid_count integer;
  budget numeric; previous_ids bigint[]; chosen_ids bigint[];
  spent integer; additions integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_manager::text,0));
  SELECT * INTO current_round FROM public.rounds ORDER BY round_number DESC LIMIT 1;
  IF current_round.id IS NULL THEN RAISE EXCEPTION 'Администратор ещё не создал тур.'; END IF;
  IF pg_catalog.now() >= current_round.deadline_at THEN RAISE EXCEPTION 'Дедлайн уже прошёл.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.managers WHERE id=p_manager) THEN
    RAISE EXCEPTION 'Менеджер не найден.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR
     pg_catalog.jsonb_array_length(p_entries) <> 8 THEN
    RAISE EXCEPTION 'Нужно ровно 8 игроков.';
  END IF;

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
      COUNT(*) FILTER(WHERE (captain OR vice) AND slot NOT IN ('goalkeeper','starter'))
    INTO unique_count,keeper_count,starter_count,bench1_count,bench2_count,
      captain_count,vice_count,invalid_count FROM chosen;
  IF unique_count<>8 OR keeper_count<>1 OR starter_count<>5 OR bench1_count<>1 OR
     bench2_count<>1 OR captain_count<>1 OR vice_count<>1 OR invalid_count<>0 THEN
    RAISE EXCEPTION 'Нужны 1 вратарь, 5 полевых, 2 запасных, капитан и вице-капитан из основы.';
  END IF;

  WITH chosen AS (
    SELECT (v->>'player_id')::bigint AS id, v->>'slot' AS slot
    FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v)
  ) SELECT COUNT(*) FILTER(WHERE p.id IS NULL OR NOT p.active OR
       (chosen.slot='goalkeeper') <> (p.position='Вратарь')),
       COALESCE(SUM(p.price),0)
    INTO invalid_count,budget FROM chosen LEFT JOIN public.players p ON p.id=chosen.id;
  IF invalid_count<>0 OR budget>50 THEN
    RAISE EXCEPTION 'Некорректные позиции игроков или превышен бюджет 50.';
  END IF;

  SELECT pg_catalog.array_agg(player_id ORDER BY player_id) INTO previous_ids
  FROM public.roster_entries WHERE round_id=current_round.id AND manager_id=p_manager;
  IF previous_ids IS NULL THEN
    SELECT id INTO previous_round FROM public.rounds
    WHERE round_number<current_round.round_number ORDER BY round_number DESC LIMIT 1;
    IF previous_round IS NOT NULL THEN
      SELECT pg_catalog.array_agg(player_id ORDER BY player_id) INTO previous_ids
      FROM public.roster_entries WHERE round_id=previous_round AND manager_id=p_manager;
    END IF;
  END IF;
  SELECT pg_catalog.array_agg((v->>'player_id')::bigint ORDER BY (v->>'player_id')::bigint)
    INTO chosen_ids FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v);
  SELECT COUNT(*) INTO additions FROM pg_catalog.unnest(chosen_ids) AS new_id
  WHERE previous_ids IS NOT NULL AND NOT (new_id=ANY(previous_ids));
  SELECT COUNT(*) INTO spent FROM public.transfers
  WHERE round_id=current_round.id AND manager_id=p_manager;
  IF NOT current_round.unlimited_transfers AND spent+additions>2 THEN RAISE EXCEPTION 'В этом туре разрешены только 2 трансфера.'; END IF;

  IF additions>0 AND NOT current_round.unlimited_transfers THEN
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
  DELETE FROM public.roster_entries WHERE round_id=current_round.id AND manager_id=p_manager;
  INSERT INTO public.roster_entries (round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
  SELECT current_round.id,p_manager,(v->>'player_id')::bigint,v->>'slot',
         COALESCE((v->>'is_captain')::boolean,false),
         COALESCE((v->>'is_vice_captain')::boolean,false)
  FROM pg_catalog.jsonb_array_elements(p_entries) AS elem(v);
  RETURN CASE WHEN current_round.unlimited_transfers THEN 0 ELSE spent+additions END;
END; $$;
REVOKE ALL ON FUNCTION public.save_fantasy_roster(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_fantasy_roster(uuid,jsonb) TO service_role;

COMMIT;
