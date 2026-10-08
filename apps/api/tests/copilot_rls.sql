-- Run ONLY in a disposable PostgreSQL database after applying 0012 to fixtures.
-- The harness supplies authenticated/anon roles, auth.uid(), travel_packages.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.save_copilot_turn(
 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
 'Japan', '{"message":"Review"}', '{}',
 '[{"item_id":"AC-1","item_type":"activity","item_name":"Food Tour","city":"Tokyo","price_unit":"per_person","details":{},"why_recommended":"Food"}]', 1
);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.copilot_suggestions) <> 1 THEN RAISE EXCEPTION 'Owner cannot read suggestion'; END IF;
 BEGIN
   PERFORM public.save_copilot_turn(
    'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
    'Bad snapshot', '{}', '{}', '[{"item_id":"bad"}]', 1);
   RAISE EXCEPTION 'Invalid snapshot unexpectedly saved';
 EXCEPTION WHEN not_null_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM public.copilot_turns WHERE turn_id = 'c0000000-0000-0000-0000-000000000002') THEN
   RAISE EXCEPTION 'Partial turn survived failed transaction';
 END IF;
 BEGIN
   UPDATE public.copilot_suggestions SET item_name = 'tampered';
   RAISE EXCEPTION 'Snapshot update unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
UPDATE public.copilot_suggestions SET status = 'accepted' WHERE item_id = 'AC-1' AND status = 'pending';
DO $$ DECLARE changed integer; BEGIN
 UPDATE public.copilot_suggestions SET status = 'dismissed' WHERE item_id = 'AC-1' AND status = 'pending';
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed <> 0 THEN RAISE EXCEPTION 'Resolved status changed again'; END IF;
END $$;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.copilot_turns) OR EXISTS (SELECT 1 FROM public.copilot_suggestions) THEN
   RAISE EXCEPTION 'Foreign conversation is visible';
 END IF;
 BEGIN
   PERFORM public.save_copilot_turn(
    'c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
    'Foreign package', '{}', '{}', '[]', 1);
   RAISE EXCEPTION 'Foreign package write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
 BEGIN
   PERFORM 1 FROM public.copilot_turns;
   RAISE EXCEPTION 'Anonymous read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   PERFORM public.save_copilot_turn(
    'c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001',
    'Anonymous', '{}', '{}', '[]', 1);
   RAISE EXCEPTION 'Anonymous RPC allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
