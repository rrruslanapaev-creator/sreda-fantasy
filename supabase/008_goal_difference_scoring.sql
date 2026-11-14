-- 008: Round 2 onward penalize negative team goal DIFFERENCE, not goals conceded.
-- Round 1 keeps its original scoring algorithm and stored results unchanged.
-- Team goal_difference = all team goals scored minus all team goals conceded
-- over the evening. Enter that signed number for each attending member.
BEGIN;
ALTER TABLE public.player_round_stats
  ADD COLUMN IF NOT EXISTS goal_difference integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.player_round_stats.goal_difference IS
  'Signed evening goal difference of the real team. From round 2 onward, each complete -3 means -1 fantasy point.';
CREATE OR REPLACE FUNCTION public.sf_calculate_round(p_round bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE counted integer;
BEGIN
  DELETE FROM public.manager_round_points WHERE round_id = p_round;
  WITH entries AS (
    SELECT e.manager_id, e.player_id, e.slot, e.is_captain, e.is_vice_captain,
      COALESCE(s.attended, false) AS attended,
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
    WHERE e.round_id=p_round
  ),
  starter_counts AS (
    SELECT manager_id, COUNT(*) FILTER (WHERE slot='starter' AND attended) AS present_starters
    FROM entries GROUP BY manager_id
  ),
  available_bench AS (
    SELECT manager_id,player_id,slot,is_captain,is_vice_captain,pts,
      ROW_NUMBER() OVER (PARTITION BY manager_id ORDER BY CASE slot WHEN 'bench1' THEN 1 ELSE 2 END) AS priority
    FROM entries WHERE slot IN ('bench1','bench2') AND attended
  ),
  selected AS (
    SELECT manager_id,player_id,is_captain,is_vice_captain,pts
    FROM entries WHERE slot IN ('goalkeeper','starter') AND attended
    UNION ALL
    SELECT b.manager_id,b.player_id,b.is_captain,b.is_vice_captain,b.pts
    FROM available_bench b JOIN starter_counts c USING (manager_id)
    WHERE b.priority <= 5-c.present_starters
  ),
  subtotals AS (
    SELECT manager_id, COALESCE(SUM(pts),0) AS raw_points,
      MAX(pts) FILTER (WHERE is_captain) AS captain_bonus,
      MAX(pts) FILTER (WHERE is_vice_captain) AS vice_bonus
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

-- Save all individual statistics as an editable draft in one transaction.
-- If already published, saved corrections immediately recalculate public scores.
CREATE OR REPLACE FUNCTION public.sf_save_results(p_admin uuid, p_round bigint, p_stats jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer; unique_n integer; player_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.managers WHERE id=p_admin AND is_admin=true)
    THEN RAISE EXCEPTION 'Только администратор может вводить результаты'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rounds WHERE id=p_round AND deadline_at<=now())
    THEN RAISE EXCEPTION 'Тур не найден или дедлайн ещё не прошёл'; END IF;
  IF pg_catalog.jsonb_typeof(p_stats) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Ожидается список статистики'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sfstats:'||p_round::text,0));
  SELECT COUNT(*),COUNT(DISTINCT player_id) INTO n,unique_n
  FROM pg_catalog.jsonb_to_recordset(p_stats) AS s(player_id bigint);
  SELECT COUNT(*) INTO player_n FROM public.players;
  IF n<>player_n OR unique_n<>player_n OR n>1000
    THEN RAISE EXCEPTION 'Нужна одна запись на каждого футболиста без повторов'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_stats) AS s(
      player_id bigint,attended boolean,goals integer,assists integer,clean_sheets integer,
      penalty_saves integer,penalty_misses integer,own_goals integer,goals_conceded integer,goal_difference integer,champion boolean)
    LEFT JOIN public.players p ON p.id=s.player_id
    WHERE p.id IS NULL OR s.player_id IS NULL
      OR COALESCE(s.goals,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.assists,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.clean_sheets,0) NOT BETWEEN 0 AND 8
      OR COALESCE(s.penalty_saves,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.penalty_misses,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.own_goals,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.goals_conceded,0) NOT BETWEEN 0 AND 100
      OR COALESCE(s.goal_difference,0) NOT BETWEEN -100 AND 100
      OR (NOT COALESCE(s.attended,false) AND (
        COALESCE(s.goals,0)+COALESCE(s.assists,0)+COALESCE(s.clean_sheets,0)
        +COALESCE(s.penalty_saves,0)+COALESCE(s.penalty_misses,0)
        +COALESCE(s.own_goals,0)+COALESCE(s.goals_conceded,0)>0
        OR COALESCE(s.goal_difference,0)<>0 OR COALESCE(s.champion,false)))
  ) THEN RAISE EXCEPTION 'Недопустимые данные: проверь статистику и присутствие'; END IF;

  -- Explicit field required for new-round scoring so older clients cannot silently
  -- save a zero differential as if it were a real, reviewed statistic.
  IF EXISTS (SELECT 1 FROM public.rounds WHERE id=p_round AND round_number>=2)
     AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_stats) AS item(v)
                 WHERE NOT (v ? 'goal_difference') OR v->>'goal_difference' IS NULL)
    THEN RAISE EXCEPTION 'Для тура со 2-го требуется разница мячей для каждого футболиста'; END IF;

  DELETE FROM public.player_round_stats WHERE round_id=p_round;
  INSERT INTO public.player_round_stats(
    round_id,player_id,attended,goals,assists,clean_sheets,
    penalty_saves,penalty_misses,own_goals,goals_conceded,goal_difference,champion)
  SELECT p_round,s.player_id,COALESCE(s.attended,false),
    COALESCE(s.goals,0),COALESCE(s.assists,0),COALESCE(s.clean_sheets,0),
    COALESCE(s.penalty_saves,0),COALESCE(s.penalty_misses,0),
    COALESCE(s.own_goals,0),COALESCE(s.goals_conceded,0),COALESCE(s.goal_difference,0),COALESCE(s.champion,false)
  FROM pg_catalog.jsonb_to_recordset(p_stats) AS s(
    player_id bigint,attended boolean,goals integer,assists integer,clean_sheets integer,
    penalty_saves integer,penalty_misses integer,own_goals integer,goals_conceded integer,goal_difference integer,champion boolean);
  IF EXISTS (SELECT 1 FROM public.round_results_publication WHERE round_id=p_round) THEN
    PERFORM public.sf_calculate_round(p_round);
    UPDATE public.round_results_publication
    SET published_at=now(),published_by=p_admin WHERE round_id=p_round;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.sf_save_results(uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sf_save_results(uuid,bigint,jsonb) TO service_role;


COMMIT;
