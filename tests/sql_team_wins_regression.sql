-- Check persisted stats, automatic recalculation of published results, and historic round protection.
DO $test$
DECLARE draft jsonb; n integer;
BEGIN
 SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('team_wins',2)) INTO draft FROM public.player_round_stats s WHERE s.round_id=4;
 PERFORM public.sf_save_results('00000000-0000-0000-0000-000000000001',4,draft);
 IF (SELECT points FROM public.manager_round_points WHERE round_id=4) IS DISTINCT FROM 13 THEN RAISE EXCEPTION 'Win bonus did not add 14 to the prior result'; END IF;
 IF EXISTS(SELECT 1 FROM public.player_round_stats WHERE round_id=4 AND team_wins<>2) THEN RAISE EXCEPTION 'Win count not persisted'; END IF;
 BEGIN
  PERFORM public.sf_save_results('00000000-0000-0000-0000-000000000001',4,(SELECT jsonb_agg(v-'team_wins') FROM jsonb_array_elements(draft) v));
  RAISE EXCEPTION 'Missing wins accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%Укажи количество побед%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.sf_save_results('00000000-0000-0000-0000-000000000001',4,(SELECT jsonb_agg(v||jsonb_build_object('attended',false,'team_wins',2)) FROM jsonb_array_elements(draft) v));
  RAISE EXCEPTION 'Absent player wins accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%Недопустимые данные%' THEN RAISE; END IF;
 END;
 PERFORM public.sf_calculate_round(1);
 IF (SELECT points FROM public.manager_round_points WHERE round_id=1) IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'Round 1 changed'; END IF;
END $test$;
