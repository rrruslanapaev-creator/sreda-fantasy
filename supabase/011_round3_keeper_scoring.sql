CREATE OR REPLACE FUNCTION public.sf_calculate_round(p_round bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE counted integer;
BEGIN
  DELETE FROM public.manager_round_points WHERE round_id = p_round;
  WITH entries AS (
    SELECT e.manager_id, e.player_id, e.slot, e.is_captain, e.is_vice_captain,
      (COALESCE(s.attended, false) AND NOT (r.round_number=3 AND p.id=14 AND e.slot='goalkeeper')) AS attended,
      CASE WHEN COALESCE(s.attended, false) AND NOT (r.round_number=3 AND p.id=14 AND e.slot='goalkeeper') THEN
        1
        + COALESCE(s.goals,0) * CASE WHEN p.position='Вратарь' AND NOT (r.round_number=3 AND p.id=14) THEN 10 ELSE 5 END
        + COALESCE(s.assists,0) * 3
        + CASE WHEN r.round_number >= 2 THEN COALESCE(s.team_wins,0) ELSE 0 END
        + COALESCE(s.clean_sheets,0) * CASE WHEN p.position='Вратарь' AND NOT (r.round_number=3 AND p.id=14) THEN 3 ELSE 1 END
        + COALESCE(s.penalty_saves,0) * 5
        - COALESCE(s.penalty_misses,0) * 2
        - COALESCE(s.own_goals,0) * 2
        - CASE WHEN r.round_number >= 2
            THEN CASE WHEN r.round_number>=3 AND p.position='Вратарь' AND NOT (r.round_number=3 AND p.id=14) THEN COALESCE(s.goals_conceded,0)/3 ELSE GREATEST(0,-COALESCE(s.goal_difference,0))/3 END
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
END; $function$
;
