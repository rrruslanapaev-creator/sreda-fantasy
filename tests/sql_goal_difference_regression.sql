-- Regression: round #1 results stay unchanged, round >=2 uses signed evening goal difference.
-- Existing CI fixture has round 1 published (16 points) and later transfer-test rounds 2 & 3.
DO $$ BEGIN
 IF (SELECT points FROM public.manager_round_points WHERE round_id=1) IS DISTINCT FROM 16
 THEN RAISE EXCEPTION 'Round 1 changed before test'; END IF;
END $$;
-- Even if explicitly recalculated under the new SQL function, round 1 keeps old formula.
SELECT public.sf_calculate_round(1);
DO $$ BEGIN
 IF (SELECT points FROM public.manager_round_points WHERE round_id=1) IS DISTINCT FROM 16
 THEN RAISE EXCEPTION 'Round 1 retroactively rescored'; END IF;
END $$;

INSERT INTO public.rounds(id,round_number,deadline_at,status)
VALUES (4,4,'2020-01-01 00:00:00+00','closed');
INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
SELECT 4,manager_id,player_id,slot,is_captain,is_vice_captain
FROM public.roster_entries WHERE round_id=1;

-- The entire draft must have the new signed field from round 2 onward.
DO $check$
BEGIN
 BEGIN
  PERFORM public.sf_save_results(
   '00000000-0000-0000-0000-000000000001',4,
   (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'player_id',id,'attended',true,'goals_conceded',6)) FROM public.players)
  );
  RAISE EXCEPTION 'Missing new-round goal difference was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Missing new-round goal difference was accepted' THEN RAISE; END IF;
  IF SQLERRM NOT LIKE '%требуется разница мячей%' THEN RAISE; END IF;
 END;
END $check$;

-- Every row includes goal_difference; large conceded values must be ignored.
SELECT public.sf_save_results(
 '00000000-0000-0000-0000-000000000001',4,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'player_id',id,'attended',true,'goals_conceded',50,
  'goal_difference',CASE id
     WHEN 1 THEN -2 WHEN 2 THEN -3 WHEN 3 THEN -6 WHEN 4 THEN 9
     WHEN 5 THEN -5 WHEN 6 THEN -9 WHEN 7 THEN -3 ELSE -6 END
 ) ORDER BY id) FROM public.players));
SELECT public.sf_publish_results('00000000-0000-0000-0000-000000000001',4);
DO $$ DECLARE got integer; BEGIN
 SELECT points INTO got FROM public.manager_round_points WHERE round_id=4;
 IF got IS DISTINCT FROM -1 THEN
  RAISE EXCEPTION 'Expected -1 based on goal difference, got %',got;
 END IF;
 IF (SELECT points FROM public.manager_round_points WHERE round_id=1) IS DISTINCT FROM 16
 THEN RAISE EXCEPTION 'Publishing round 4 modified old results'; END IF;
END $$;
