-- Full event import: captain absent, vice present, bench 1 replaces captain,
-- bench 2 is present but must NOT score. Everyone present conceded 5.
SELECT public.sf_save_results(
 '00000000-0000-0000-0000-000000000001',1,
 (SELECT pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object(
    'player_id',id,
    'attended',id<>2,
    'goals',CASE WHEN id=3 THEN 1 WHEN id=8 THEN 10 ELSE 0 END,
    'assists',CASE WHEN id=7 THEN 1 ELSE 0 END,
    'goals_conceded',CASE WHEN id=2 THEN 0 ELSE 5 END
   ) ORDER BY id)
 FROM public.players));
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.manager_round_points WHERE round_id=1) THEN
  RAISE EXCEPTION 'Draft must not modify public scoring'; END IF;
END $$;
SELECT public.sf_publish_results('00000000-0000-0000-0000-000000000001',1);
DO $$ DECLARE got integer; BEGIN
 SELECT points INTO got FROM public.manager_round_points WHERE round_id=1;
 IF got IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'Expected 6 with vice captain and bench priority, got %',got; END IF;
END $$;

-- Correct an already-published result: saving should automatically recalculate.
SELECT public.sf_save_results(
 '00000000-0000-0000-0000-000000000001',1,
 (SELECT pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object(
    'player_id',id,
    'attended',id<>2,
    'goals',CASE WHEN id=3 THEN 2 WHEN id=8 THEN 10 ELSE 0 END,
    'assists',CASE WHEN id=7 THEN 1 ELSE 0 END,
    'goals_conceded',CASE WHEN id=2 THEN 0 ELSE 5 END
   ) ORDER BY id)
 FROM public.players));
DO $$ DECLARE got integer; BEGIN
 SELECT points INTO got FROM public.manager_round_points WHERE round_id=1;
 IF got IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'Expected 16 after published correction, got %',got; END IF;
END $$;

-- Non-admin must never be able to overwrite results.
INSERT INTO public.managers VALUES('00000000-0000-0000-0000-000000000002','member',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.sf_publish_results('00000000-0000-0000-0000-000000000002',1);
  RAISE EXCEPTION 'Non-admin was allowed to publish';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Non-admin was allowed to publish' THEN RAISE; END IF;
 END;
END $$;
