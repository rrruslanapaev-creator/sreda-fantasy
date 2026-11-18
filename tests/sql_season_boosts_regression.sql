-- Post-009 integration tests run in a throwaway PostgreSQL container.
-- Earlier fixtures: rounds 1..4, players 1..12, round1 roster 8 players.
INSERT INTO public.rounds(id,round_number,deadline_at,status)
VALUES(5,5,'2100-01-01 00:00:00+00','upcoming');

INSERT INTO public.managers(id,username,is_admin) VALUES
 ('00000000-0000-0000-0000-000000000003','Wildcard tester',false),
 ('00000000-0000-0000-0000-000000000004','Bench tester',false),
 ('00000000-0000-0000-0000-000000000005','Captain tester',false);

INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
SELECT 5,manager_id,player_id,slot,is_captain,is_vice_captain
FROM public.roster_entries WHERE round_id=1;
INSERT INTO public.roster_entries(round_id,manager_id,player_id,slot,is_captain,is_vice_captain)
SELECT 5,m.id,e.player_id,e.slot,e.is_captain,e.is_vice_captain
FROM public.roster_entries e
CROSS JOIN public.managers m
WHERE e.round_id=1 AND m.id IN
 ('00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005');

-- Free Hit can change 3+ roster players without consuming transfers.
SELECT public.sf_save_boosted_roster(
 '00000000-0000-0000-0000-000000000001',
 (SELECT jsonb_agg(jsonb_build_object('player_id',x.id,'slot',x.slot,'is_captain',x.cap,'is_vice_captain',x.vice))
 FROM (VALUES
  (1,'goalkeeper',false,false),(2,'starter',true,false),(3,'starter',false,true),
  (9,'starter',false,false),(10,'starter',false,false),(11,'starter',false,false),
  (7,'bench1',false,false),(8,'bench2',false,false)
 ) AS x(id,slot,cap,vice)),
 'free_hit'
);
DO $check$
BEGIN
 IF (SELECT COUNT(*) FROM public.transfers WHERE round_id=5)<>0 THEN RAISE EXCEPTION 'Free Hit consumed transfers'; END IF;
 IF (SELECT COUNT(*) FROM public.manager_boosts WHERE round_id=5 AND boost='free_hit')<>1 THEN RAISE EXCEPTION 'Free Hit not activated'; END IF;
 IF (SELECT jsonb_array_length(base_roster) FROM public.manager_boosts WHERE manager_id='00000000-0000-0000-0000-000000000001' AND round_id=5)<>8
 THEN RAISE EXCEPTION 'Free Hit base squad not preserved'; END IF;
END $check$;

-- Cannot activate a second bonus in the same round.
DO $check$
BEGIN
 BEGIN
  PERFORM public.sf_save_boosted_roster(
  '00000000-0000-0000-0000-000000000001',
   (SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'slot',slot,'is_captain',is_captain,'is_vice_captain',is_vice_captain))
    FROM public.roster_entries WHERE round_id=5 AND manager_id='00000000-0000-0000-0000-000000000001'),
    'bench_boost');
  RAISE EXCEPTION 'Accepted second boost in same round';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Accepted second boost in same round' THEN RAISE; END IF;
  IF SQLERRM NOT LIKE '%уже активирован другой бонус%' THEN RAISE; END IF;
 END;
END $check$;

-- Wildcard keeps the rebuilt team into the next round.
SELECT public.sf_save_boosted_roster(
 '00000000-0000-0000-0000-000000000003',
 (SELECT jsonb_agg(jsonb_build_object('player_id',x.id,'slot',x.slot,'is_captain',x.cap,'is_vice_captain',x.vice))
 FROM (VALUES
  (1,'goalkeeper',false,false),(2,'starter',true,false),(3,'starter',false,true),
  (9,'starter',false,false),(10,'starter',false,false),(11,'starter',false,false),
  (7,'bench1',false,false),(8,'bench2',false,false)
 ) AS x(id,slot,cap,vice)),
 'wildcard'
);
INSERT INTO public.rounds(id,round_number,deadline_at,status)
VALUES(6,6,'2020-01-01 00:00:00+00','closed');
SELECT public.sf_rollover_rosters(5,6);

DO $check$
BEGIN
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=6)<>32
 THEN RAISE EXCEPTION 'Expected four unchanged 8-player squads'; END IF;
 IF EXISTS(SELECT 1 FROM public.roster_entries WHERE round_id=6
  AND manager_id='00000000-0000-0000-0000-000000000001' AND player_id IN (9,10,11))
 THEN RAISE EXCEPTION 'Free Hit new squad was incorrectly kept'; END IF;
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=6
  AND manager_id='00000000-0000-0000-0000-000000000001' AND player_id IN (4,5,6))<>3
 THEN RAISE EXCEPTION 'Free Hit original squad not restored'; END IF;
 IF (SELECT COUNT(*) FROM public.roster_entries WHERE round_id=6
  AND manager_id='00000000-0000-0000-0000-000000000003' AND player_id IN (9,10,11))<>3
 THEN RAISE EXCEPTION 'Wildcard squad not retained'; END IF;
END $check$;

-- The boost cannot be used twice in the same season, even in a different round.
DO $check$
BEGIN
 BEGIN
  INSERT INTO public.manager_boosts(manager_id,round_id,season_code,boost)
  VALUES('00000000-0000-0000-0000-000000000001',6,'rimi-26-27','free_hit');
  RAISE EXCEPTION 'Same boost used twice';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $check$;

-- Score round6 with 1 point per player except the field captain earns 6.
INSERT INTO public.player_round_stats(round_id,player_id,attended,goals,goal_difference)
SELECT 6,id,true,CASE WHEN id=2 THEN 1 ELSE 0 END,0 FROM public.players;

INSERT INTO public.manager_boosts(manager_id,round_id,season_code,boost)
VALUES
 ('00000000-0000-0000-0000-000000000004',6,'rimi-26-27','bench_boost'),
 ('00000000-0000-0000-0000-000000000005',6,'rimi-26-27','triple_captain');
SELECT public.sf_calculate_round(6);
DO $check$
DECLARE standard_points integer; benched_points integer; tripled_points integer;
BEGIN
 SELECT points INTO standard_points FROM public.manager_round_points WHERE round_id=6 AND manager_id='00000000-0000-0000-0000-000000000001';
 SELECT points INTO benched_points FROM public.manager_round_points WHERE round_id=6 AND manager_id='00000000-0000-0000-0000-000000000004';
 SELECT points INTO tripled_points FROM public.manager_round_points WHERE round_id=6 AND manager_id='00000000-0000-0000-0000-000000000005';
 IF standard_points<>17 OR benched_points<>19 OR tripled_points<>23 THEN
  RAISE EXCEPTION 'Boost scoring mismatch: normal %, bench %, captain %',standard_points,benched_points,tripled_points;
 END IF;
END $check$;
