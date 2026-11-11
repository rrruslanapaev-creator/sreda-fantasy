-- Regression: market updates preserve prices paid in already saved squads.
INSERT INTO public.rounds(id,round_number,deadline_at,status)
 VALUES(2,2,'2099-01-01 20:30+00','open');
SELECT public.save_fantasy_roster(
 '00000000-0000-0000-0000-000000000001',
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'player_id',id,
  'slot',CASE WHEN id=1 THEN 'goalkeeper' WHEN id=7 THEN 'bench1'
    WHEN id=8 THEN 'bench2' ELSE 'starter' END,
  'is_captain',id=2,'is_vice_captain',id=3) ORDER BY id) FROM public.players WHERE id<=8));
DO $$ DECLARE spent numeric; BEGIN
 SELECT SUM(purchase_price) INTO spent
 FROM public.roster_entries WHERE round_id=2;
 IF spent IS DISTINCT FROM 40 THEN RAISE EXCEPTION 'Expected squad to cost 40; got %',spent; END IF;
END $$;
SELECT public.sf_update_market_price('00000000-0000-0000-0000-000000000001',2,30);
DO $$ DECLARE paid numeric; current_price numeric; BEGIN
 SELECT purchase_price INTO paid FROM public.roster_entries
 WHERE round_id=2 AND player_id=2;
 SELECT price INTO current_price FROM public.players WHERE id=2;
 IF paid<>5 OR current_price<>30 THEN RAISE EXCEPTION 'Original purchase price was lost'; END IF;
END $$;
-- The old squad must still be valid even though its current market sum is 65.
SELECT public.save_fantasy_roster(
 '00000000-0000-0000-0000-000000000001',
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'player_id',id,
  'slot',CASE WHEN id=1 THEN 'goalkeeper' WHEN id=7 THEN 'bench1'
    WHEN id=8 THEN 'bench2' ELSE 'starter' END,
  'is_captain',id=2,'is_vice_captain',id=3) ORDER BY id) FROM public.players WHERE id<=8));

-- A new acquisition uses the NEW price and requires a transfer.
SELECT public.sf_add_market_player('00000000-0000-0000-0000-000000000001','New Player','Полевой',12);
DO $$ DECLARE new_id bigint; price_paid numeric; n integer; BEGIN
 SELECT id INTO new_id FROM public.players WHERE name='New Player';
 SELECT public.save_fantasy_roster(
  '00000000-0000-0000-0000-000000000001',
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'player_id',id,
    'slot',CASE WHEN id=1 THEN 'goalkeeper' WHEN id=7 THEN 'bench1'
      WHEN id=8 THEN 'bench2' ELSE 'starter' END,
    'is_captain',id=2,'is_vice_captain',id=3) ORDER BY id)
   FROM public.players WHERE id IN (1,2,3,4,5,7,8,new_id))
 ) INTO n;
 IF n<>1 THEN RAISE EXCEPTION 'Expected exactly one transfer, got %',n; END IF;
 SELECT purchase_price INTO price_paid FROM public.roster_entries
 WHERE round_id=2 AND player_id=new_id;
 IF price_paid<>12 THEN RAISE EXCEPTION 'New player did not use market price: %',price_paid; END IF;
 IF (SELECT SUM(purchase_price) FROM public.roster_entries WHERE round_id=2)<>47
  THEN RAISE EXCEPTION 'Expected final squad price 47'; END IF;
END $$;

-- No ability to create duplicates by varying letter case.
DO $$ BEGIN
 BEGIN
  PERFORM public.sf_add_market_player('00000000-0000-0000-0000-000000000001',' NEW PLAYER ','Полевой',3);
  RAISE EXCEPTION 'Duplicate name unexpectedly accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Duplicate name unexpectedly accepted' THEN RAISE; END IF;
 END;
END $$;

-- A regular account cannot modify the market.
DO $$ BEGIN
 BEGIN
  PERFORM public.sf_update_market_price('00000000-0000-0000-0000-000000000002',2,4);
  RAISE EXCEPTION 'Non-admin changed the market';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Non-admin changed the market' THEN RAISE; END IF;
 END;
END $$;
