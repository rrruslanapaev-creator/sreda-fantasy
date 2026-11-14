-- Requested market repricing, November 14, 2026.
-- Intentionally changes only five current market prices.
-- Does NOT touch rosters, transfer logs, player round statistics or manager scores.
BEGIN;
DO $validate_old_prices$
DECLARE matches integer;
BEGIN
 SELECT COUNT(*) INTO matches FROM public.players
 WHERE (id=16 AND name='Руслан Ап.' AND price=8.0)
    OR (id=17 AND name='Витя Не.' AND price=8.0)
    OR (id=18 AND name='Макс Ив.' AND price=8.0)
    OR (id=37 AND name='Петя Бо.' AND price=2.5)
    OR (id=14 AND name='Спратус' AND price=8.0);
 IF matches<>5 THEN
  RAISE EXCEPTION 'Expected exactly five players at the old prices, found %',matches;
 END IF;
END $validate_old_prices$;
UPDATE public.players SET price=CASE id
 WHEN 16 THEN 7.5
 WHEN 17 THEN 9.0
 WHEN 18 THEN 8.5
 WHEN 37 THEN 4.5
 WHEN 14 THEN 5.5
 END
WHERE id IN(16,17,18,37,14);
COMMIT;
