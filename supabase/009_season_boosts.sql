-- 009: One single-use boost of each type per manager and season.
-- Apply only to an isolated staging database until the owner approves production.
BEGIN;
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS season_code text NOT NULL DEFAULT 'rimi-26-27';
CREATE TABLE IF NOT EXISTS public.manager_boosts (
 manager_id uuid NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
 round_id bigint NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
 season_code text NOT NULL,
 boost text NOT NULL CHECK (boost IN ('wildcard','free_hit','triple_captain','bench_boost')),
 base_roster jsonb NOT NULL DEFAULT '[]'::jsonb,
 activated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(manager_id,round_id),
 UNIQUE(manager_id,season_code,boost)
);
ALTER TABLE public.manager_boosts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_boosts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.manager_boosts TO service_role;
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
  IF NOT current_round.unlimited_transfers AND NOT EXISTS (
    SELECT 1 FROM public.manager_boosts b WHERE b.manager_id=p_manager AND b.round_id=current_round.id AND b.boost IN ('wildcard','free_hit')
  ) AND spent+additions>2 THEN RAISE EXCEPTION 'В этом туре разрешены только 2 трансфера.'; END IF;

  IF additions>0 AND NOT current_round.unlimited_transfers AND NOT EXISTS (
    SELECT 1 FROM public.manager_boosts b WHERE b.manager_id=p_manager AND b.round_id=current_round.id AND b.boost IN ('wildcard','free_hit')
  ) THEN
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


CREATE OR REPLACE FUNCTION public.sf_calculate_round(p_round bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE counted integer;
BEGIN
  DELETE FROM public.manager_round_points WHERE round_id = p_round;
  WITH entries AS (
    SELECT e.manager_id, e.player_id, e.slot, e.is_captain, e.is_vice_captain,
      COALESCE(b.boost,'') AS boost, COALESCE(s.attended, false) AS attended,
      CASE WHEN COALESCE(s.attended, false) THEN
        1
        + COALESCE(s.goals,0) * CASE WHEN p.position='Вратарь' THEN 10 ELSE 5 END
        + COALESCE(s.assists,0) * 3
        + COALESCE(s.clean_sheets,0) * CASE WHEN p.position='Вратарь' THEN 3 ELSE 1 END
        + COALESCE(s.penalty_saves,0) * 5
        - COALESCE(s.penalty_misses,0) * 2
        - COALESCE(s.own_goals,0) * 2
        - CASE WHEN r.round_number >= 2
            THEN GREATEST(0,-COALESCE(s.goal_difference,0)) / 3
            ELSE COALESCE(s.goals_conceded,0) / 2
          END
        + CASE WHEN COALESCE(s.champion,false) THEN 2 ELSE 0 END
      ELSE 0 END AS pts
    FROM public.roster_entries e
    JOIN public.rounds r ON r.id=e.round_id
    JOIN public.players p ON p.id=e.player_id
    LEFT JOIN public.player_round_stats s ON s.round_id=e.round_id AND s.player_id=e.player_id
    LEFT JOIN public.manager_boosts b ON b.round_id=e.round_id AND b.manager_id=e.manager_id
    WHERE e.round_id=p_round
  ),
  starter_counts AS (
    SELECT manager_id, COUNT(*) FILTER (WHERE slot='starter' AND attended) AS present_starters
    FROM entries GROUP BY manager_id
  ),
  available_bench AS (
    SELECT manager_id,player_id,slot,is_captain,is_vice_captain,pts,boost,
      ROW_NUMBER() OVER (PARTITION BY manager_id ORDER BY CASE slot WHEN 'bench1' THEN 1 ELSE 2 END) AS priority
    FROM entries WHERE slot IN ('bench1','bench2') AND attended
  ),
  selected AS (
    SELECT manager_id,player_id,is_captain,is_vice_captain,pts,boost
    FROM entries WHERE slot IN ('goalkeeper','starter') AND attended
    UNION ALL
    SELECT b.manager_id,b.player_id,b.is_captain,b.is_vice_captain,b.pts,b.boost
    FROM available_bench b JOIN starter_counts c USING (manager_id)
    WHERE b.priority <= 5-c.present_starters OR b.boost='bench_boost'
  ),
  subtotals AS (
    SELECT manager_id, COALESCE(SUM(pts),0) AS raw_points,
      MAX(CASE WHEN boost='triple_captain' THEN pts*2 ELSE pts END) FILTER (WHERE is_captain) AS captain_bonus,
      MAX(CASE WHEN boost='triple_captain' THEN pts*2 ELSE pts END) FILTER (WHERE is_vice_captain) AS vice_bonus
    FROM selected GROUP BY manager_id
  )
  INSERT INTO public.manager_round_points(round_id,manager_id,points)
  SELECT p_round, managers.manager_id,
    (COALESCE(t.raw_points,0) + COALESCE(t.captain_bonus,t.vice_bonus,0))::integer
  FROM (SELECT DISTINCT manager_id FROM public.roster_entries WHERE round_id=p_round) managers
  LEFT JOIN subtotals t USING (manager_id);
  GET DIAGNOSTICS counted = ROW_COUNT;
  RETURN counted;
END; $$;
REVOKE ALL ON FUNCTION public.sf_calculate_round(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_calculate_round(bigint) TO service_role;



-- Atomic boost activation and roster save. Once activated, this round's boost
-- cannot be switched or cancelled. A failed roster validation rolls back boost usage.
CREATE OR REPLACE FUNCTION public.sf_save_boosted_roster(
 p_manager uuid, p_entries jsonb, p_boost text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $boost$
DECLARE
 live_round public.rounds%ROWTYPE;
 existing_boost text;
 snapshot jsonb;
 prev_round bigint;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_manager::text,0));
 SELECT * INTO live_round FROM public.rounds ORDER BY round_number DESC LIMIT 1;
 IF live_round.id IS NULL OR now()>=live_round.deadline_at THEN
  RAISE EXCEPTION 'Дедлайн уже прошёл.';
 END IF;
 IF p_boost IS NOT NULL AND p_boost NOT IN ('wildcard','free_hit','triple_captain','bench_boost') THEN
  RAISE EXCEPTION 'Неизвестный бонус.';
 END IF;
 SELECT boost INTO existing_boost FROM public.manager_boosts
 WHERE manager_id=p_manager AND round_id=live_round.id;
 IF existing_boost IS NOT NULL AND p_boost IS NOT NULL AND existing_boost<>p_boost THEN
  RAISE EXCEPTION 'На текущий тур уже активирован другой бонус.';
 END IF;
 IF existing_boost IS NULL AND p_boost IS NOT NULL THEN
   IF EXISTS (SELECT 1 FROM public.manager_boosts
              WHERE manager_id=p_manager AND season_code=live_round.season_code AND boost=p_boost) THEN
     RAISE EXCEPTION 'Этот бонус уже использован в сезоне.';
   END IF;
   IF p_boost='free_hit' THEN
     SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'player_id',e.player_id,'slot',e.slot,
       'is_captain',e.is_captain,'is_vice_captain',e.is_vice_captain
     ) ORDER BY e.id) INTO snapshot
     FROM public.roster_entries e
     WHERE e.manager_id=p_manager AND e.round_id=live_round.id;
     IF snapshot IS NULL THEN
       SELECT id INTO prev_round FROM public.rounds
       WHERE round_number<live_round.round_number ORDER BY round_number DESC LIMIT 1;
       SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'player_id',e.player_id,'slot',e.slot,
         'is_captain',e.is_captain,'is_vice_captain',e.is_vice_captain
       ) ORDER BY e.id) INTO snapshot
       FROM public.roster_entries e WHERE e.manager_id=p_manager AND e.round_id=prev_round;
     END IF;
   END IF;
   INSERT INTO public.manager_boosts(manager_id,round_id,season_code,boost,base_roster)
   VALUES(p_manager,live_round.id,live_round.season_code,p_boost,COALESCE(snapshot,'[]'::jsonb));
 END IF;
 RETURN public.save_fantasy_roster(p_manager,p_entries);
END; $boost$;
REVOKE ALL ON FUNCTION public.sf_save_boosted_roster(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_save_boosted_roster(uuid,jsonb,text) TO service_role;

-- When a new round is opened, rollover must use this function, not a plain
-- INSERT ... SELECT. Free Hit restores the captured pre-boost squad.
CREATE OR REPLACE FUNCTION public.sf_rollover_rosters(p_source_round bigint,p_target_round bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $roll$
DECLARE n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=p_source_round)
 OR NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=p_target_round) THEN
  RAISE EXCEPTION 'Тур не найден.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.roster_entries WHERE round_id=p_target_round) THEN
  RAISE EXCEPTION 'Новый тур уже содержит составы.';
 END IF;
 INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
 SELECT p_target_round,e.manager_id,e.player_id,e.slot,e.is_captain,e.is_vice_captain
 FROM public.roster_entries e
 LEFT JOIN public.manager_boosts b
    ON b.round_id=p_source_round AND b.manager_id=e.manager_id AND b.boost='free_hit'
 WHERE e.round_id=p_source_round AND b.manager_id IS NULL
 UNION ALL
 SELECT p_target_round,b.manager_id,t.player_id,t.slot,t.is_captain,t.is_vice_captain
 FROM public.manager_boosts b
 CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(b.base_roster) AS t(
  player_id bigint,slot text,is_captain boolean,is_vice_captain boolean)
 WHERE b.round_id=p_source_round AND b.boost='free_hit';
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END; $roll$;
REVOKE ALL ON FUNCTION public.sf_rollover_rosters(bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_rollover_rosters(bigint,bigint) TO service_role;
COMMIT;
