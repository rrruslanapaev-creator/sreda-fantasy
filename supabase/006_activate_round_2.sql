-- Sreda Fantasy: activate round #2 on November 18 at 20:30 Europe/Riga.
-- Run ONCE after deploying code that reads rounds.unlimited_transfers and after migration 005.
-- Keeps round #1, all published scores, rosters and accounts unchanged.
BEGIN;
DO $open_second_round$
DECLARE
  old_id bigint; new_id bigint; expected_count integer; actual_count integer;
BEGIN
  SELECT id INTO old_id FROM public.rounds WHERE round_number=1 AND status='finished';
  IF old_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.round_results_publication WHERE round_id=old_id
  ) THEN RAISE EXCEPTION 'Round 1 must be finished and published'; END IF;
  IF EXISTS(SELECT 1 FROM public.rounds WHERE round_number>=2) THEN
    RAISE EXCEPTION 'A newer round already exists; refusing to overwrite anything'; END IF;
  SELECT COUNT(*) INTO expected_count FROM public.roster_entries WHERE round_id=old_id;

  INSERT INTO public.rounds(round_number,kickoff_at,deadline_at,status,unlimited_transfers)
  VALUES(
    2,
    TIMESTAMP '2026-11-18 20:30' AT TIME ZONE 'Europe/Riga',
    TIMESTAMP '2026-11-18 20:30' AT TIME ZONE 'Europe/Riga',
    'upcoming',
    true
  ) RETURNING id INTO new_id;

  INSERT INTO public.roster_entries(
    round_id,manager_id,player_id,slot,is_captain,is_vice_captain
  )
  SELECT new_id,manager_id,player_id,slot,is_captain,is_vice_captain
  FROM public.roster_entries WHERE round_id=old_id;

  SELECT COUNT(*) INTO actual_count FROM public.roster_entries WHERE round_id=new_id;
  IF actual_count<>expected_count THEN
    RAISE EXCEPTION 'Copied % of % roster entries',actual_count,expected_count; END IF;
  IF EXISTS(SELECT 1 FROM public.manager_round_points WHERE round_id=new_id) THEN
    RAISE EXCEPTION 'New round must not have points yet'; END IF;
END $open_second_round$;
COMMIT;
