-- Regression for round-scoped free full-team rebuilds.
-- Runs only in temporary CI PostgreSQL fixture, not on live production.
INSERT INTO public.players(id,name,position,price,active) VALUES
 (9,'Extra9','Полевой',5,true),(10,'Extra10','Полевой',5,true),
 (11,'Extra11','Полевой',5,true),(12,'Extra12','Полевой',5,true);
INSERT INTO public.rounds(id,round_number,deadline_at,status,unlimited_transfers)
 VALUES(2,2,'2100-11-18 18:30+00','upcoming',true);

-- Carry over the existing eight-player squad into a new editable round.
INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
SELECT 2,manager_id,player_id,slot,is_captain,is_vice_captain
FROM public.roster_entries WHERE round_id=1;
DO $$ BEGIN
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=2)<>8
   THEN RAISE EXCEPTION 'Round 2 rollover failed'; END IF;
END $$;

-- Rebuild three footballers immediately: would exceed the normal 2-transfer limit.
SELECT public.save_fantasy_roster(
 '00000000-0000-0000-0000-000000000001',
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'player_id',v.id,'slot',v.slot,'is_captain',v.captain,'is_vice_captain',v.vice))
 FROM (VALUES
 (1,'goalkeeper',false,false),(2,'starter',true,false),(3,'starter',false,true),
 (9,'starter',false,false),(10,'starter',false,false),(11,'starter',false,false),
 (7,'bench1',false,false),(8,'bench2',false,false)
 ) AS v(id,slot,captain,vice))
) AS free_transfer_result;
DO $$ BEGIN
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=2)<>8 OR
    (SELECT COUNT(*) FROM public.transfers WHERE round_id=2)<>0 THEN
  RAISE EXCEPTION 'Free rebuild must not consume transfers or change squad size'; END IF;
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=1)<>8 THEN
  RAISE EXCEPTION 'Published roster was modified'; END IF;
 IF (SELECT points FROM public.manager_round_points WHERE round_id=1)<>16 THEN
  RAISE EXCEPTION 'Published manager points were reset'; END IF;
END $$;

-- And one more subsequent change for the same manager: still unrestricted.
SELECT public.save_fantasy_roster(
 '00000000-0000-0000-0000-000000000001',
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'player_id',v.id,'slot',v.slot,'is_captain',v.captain,'is_vice_captain',v.vice))
 FROM (VALUES
 (1,'goalkeeper',false,false),(2,'starter',true,false),(3,'starter',false,true),
 (9,'starter',false,false),(10,'starter',false,false),(12,'starter',false,false),
 (7,'bench1',false,false),(8,'bench2',false,false)
 ) AS v(id,slot,captain,vice))
) AS extra_free_result;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.transfers WHERE round_id=2)
  THEN RAISE EXCEPTION 'No transfer cost should be recorded in free round'; END IF;
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=2)<>8
  THEN RAISE EXCEPTION 'Saved free-round team incomplete'; END IF;
END $$;

-- Default next round remains limited to two transfers, as before.
INSERT INTO public.rounds(id,round_number,deadline_at,status)
 VALUES(3,3,'2100-11-25 18:30+00','upcoming');
DO $$ BEGIN
 BEGIN
  PERFORM public.save_fantasy_roster(
   '00000000-0000-0000-0000-000000000001',
   (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'player_id',v.id,'slot',v.slot,'is_captain',v.captain,'is_vice_captain',v.vice))
   FROM (VALUES
   (1,'goalkeeper',false,false),(2,'starter',true,false),(3,'starter',false,true),
   (4,'starter',false,false),(5,'starter',false,false),(6,'starter',false,false),
   (7,'bench1',false,false),(8,'bench2',false,false)
   ) AS v(id,slot,captain,vice))
  );
  RAISE EXCEPTION 'NORMAL_ROUND_LIMIT_NOT_ENFORCED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='NORMAL_ROUND_LIMIT_NOT_ENFORCED' THEN RAISE; END IF;
  IF SQLERRM NOT LIKE '%только 2 трансфера%' THEN RAISE; END IF;
 END;
END $$;
