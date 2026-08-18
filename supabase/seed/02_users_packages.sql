-- Users, packages & related seed. Requires 01_catalog.sql applied first.
-- Run: psql "$DATABASE_URL" -f supabase/seed/02_users_packages.sql
-- All seed users: password "Password123!", emails end in @seed.local.
-- Rerunnable: deletes seed rows (cascades from auth.users / fixed package IDs) then reinserts.

BEGIN;

-- ---------- cleanup (rerun safety) ----------
DELETE FROM public.travel_packages WHERE package_id::text LIKE 'b0000000-%';
DELETE FROM public.feasibility_rules WHERE rule_id::text LIKE 'f0000000-%';
DELETE FROM auth.users WHERE email LIKE '%@seed.local'; -- cascades to profiles etc.

-- ---------- auth users (trigger creates public.profiles) ----------
-- Token columns must be '' not NULL: GoTrue scans them into non-nullable Go
-- strings, and a NULL makes every admin/auth query touching the row fail.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, crypt('Password123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name), now(), now(),
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'mia.influencer@seed.local',  'Mia Tanaka'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'leo.influencer@seed.local',  'Leo Vandermeer'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'aria.influencer@seed.local', 'Aria Kowalski'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'admin@seed.local',           'Priya Sharma'),
  ('a0000000-0000-0000-0000-000000000005'::uuid, 'sam.customer@seed.local',    'Sam Whitfield'),
  ('a0000000-0000-0000-0000-000000000006'::uuid, 'nora.customer@seed.local',   'Nora Castellanos')
) AS u(id, email, full_name);

INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  now(), now(), now()
FROM auth.users WHERE email LIKE '%@seed.local';

UPDATE public.profiles SET role = 'admin',
  avatar_url = 'https://i.pravatar.cc/150?u=admin'
  WHERE id = 'a0000000-0000-0000-0000-000000000004';
UPDATE public.profiles SET role = 'customer',
  avatar_url = 'https://i.pravatar.cc/150?u=' || id::text
  WHERE id IN ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006');
UPDATE public.profiles SET avatar_url = 'https://i.pravatar.cc/150?u=' || id::text
  WHERE avatar_url IS NULL AND id::text LIKE 'a0000000-%';

INSERT INTO public.influencer_profiles (user_id, bio, social_handle, follower_count, specialty, verified) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tokyo-based creator sharing food-first city guides across Asia.', '@mia.eats.world', 482000, 'food & culture', TRUE),
  ('a0000000-0000-0000-0000-000000000002', 'Adventure filmmaker chasing mountains, fjords and powder.', '@leo.outside', 213000, 'adventure', TRUE),
  ('a0000000-0000-0000-0000-000000000003', 'Budget-luxe European city breaks and hidden-gem itineraries.', '@aria.wanders', 96000, 'city breaks', FALSE);

-- ---------- travel packages ----------
-- statuses: 3 live, 2 approved, 1 pending_review, 1 rejected, 1 draft
INSERT INTO public.travel_packages (package_id, creator_id, title, description,
  destination_city, destination_country, duration_days, base_price_aud, status,
  suitable_for, submitted_at, published_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Tokyo Street Food & Culture Week', 'Seven days eating your way through Tokyo — markets, izakayas, a hands-on cooking class and the city''s best walking tours.',
   'Tokyo', 'Japan', 7, 3890, 'live', 'couples, foodies', now() - interval '30 days', now() - interval '25 days'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   'Queenstown Adrenaline Escape', 'Five days of hikes, ziplines and lake cruises in New Zealand''s adventure capital.',
   'Queenstown', 'New Zealand', 5, 2450, 'live', 'adventure seekers', now() - interval '21 days', now() - interval '18 days'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
   'Paris Long Weekend, Done Right', 'Four days of galleries, patisserie crawls and golden-hour river cruises.',
   'Paris', 'France', 4, 2980, 'live', 'couples', now() - interval '14 days', now() - interval '10 days'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001',
   'Bali Slow Travel Reset', 'Ten unhurried days in Bali: yoga at sunrise, snorkelling day trips and spa afternoons.',
   'Denpasar', 'Indonesia', 10, 3150, 'approved', 'couples, solo travellers', now() - interval '9 days', NULL),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003',
   'Rome for First-Timers', 'Six days covering the classics without the queues, plus the trattorias locals actually use.',
   'Rome', 'Italy', 6, 3320, 'approved', 'families, everyone', now() - interval '8 days', NULL),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002',
   'New York Five-Borough Sprint', 'Five fast days across NYC — skyline decks, live music nights and the best slice tour in Brooklyn.',
   'New York', 'United States', 5, 4680, 'pending_review', 'groups, adults', now() - interval '2 days', NULL),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002',
   'Bangkok on a Shoestring', 'Budget week in Bangkok: street food, canal boats and rooftop sunsets.',
   'Bangkok', 'Thailand', 7, 1490, 'rejected', 'backpackers, solo travellers', now() - interval '6 days', NULL),
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001',
   'Cusco & Sacred Valley (WIP)', 'Draft: acclimatisation days, Sacred Valley day trips and the food scene nobody talks about.',
   'Cusco', 'Peru', 8, 3900, 'draft', 'active travellers', NULL, NULL);

-- ---------- package components (catalog FKs from 01_catalog.sql) ----------
INSERT INTO public.package_flights (package_id, flight_id, day_number, sequence_order, notes) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'VA120-20260401', 1, 1, 'Outbound SYD → NRT'),
  ('b0000000-0000-0000-0000-000000000002', 'JQ137-20260504', 1, 1, 'Outbound SYD → ZQN'),
  ('b0000000-0000-0000-0000-000000000003', 'KE188-20260403', 1, 1, 'Arrival into CDG'),
  ('b0000000-0000-0000-0000-000000000004', 'VA121-20260406', 1, 1, 'Outbound SYD → DPS'),
  ('b0000000-0000-0000-0000-000000000005', 'JL171-20260403', 1, 1, 'Arrival into FCO'),
  ('b0000000-0000-0000-0000-000000000006', 'AA292-20260427', 5, 2, 'Return JFK → SYD'),
  ('b0000000-0000-0000-0000-000000000007', 'QF115-20260406', 1, 1, 'Outbound BNE → BKK');

INSERT INTO public.package_hotels (package_id, hotel_id, check_in_day, check_out_day, nights, notes) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'HT-NRT-002', 1, 8, 7, 'Garden residence near Shinjuku'),
  ('b0000000-0000-0000-0000-000000000002', 'HT-ZQN-001', 1, 6, 5, 'Lake view rooms'),
  ('b0000000-0000-0000-0000-000000000003', 'HT-CDG-002', 1, 5, 4, NULL),
  ('b0000000-0000-0000-0000-000000000004', 'HT-DPS-002', 1, 11, 10, 'Pool villa upgrade available'),
  ('b0000000-0000-0000-0000-000000000005', 'HT-FCO-002', 1, 7, 6, 'Walkable to Trastevere'),
  ('b0000000-0000-0000-0000-000000000006', 'HT-JFK-001', 1, 6, 5, NULL),
  ('b0000000-0000-0000-0000-000000000007', 'HT-BKK-001', 1, 8, 7, NULL),
  ('b0000000-0000-0000-0000-000000000008', 'HT-CUZ-001', 1, 9, 8, 'Altitude-friendly, near Plaza de Armas');

INSERT INTO public.package_activities (package_id, activity_id, day_number, sequence_order, notes) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'AC-NRT-001', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000001', 'AC-NRT-002', 3, 1, 'Morning class, market visit included'),
  ('b0000000-0000-0000-0000-000000000001', 'AC-NRT-004', 5, 1, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'AC-ZQN-001', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000002', 'AC-ZQN-004', 3, 1, NULL),
  ('b0000000-0000-0000-0000-000000000003', 'AC-CDG-004', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000003', 'AC-CDG-001', 2, 2, 'Evening food walk'),
  ('b0000000-0000-0000-0000-000000000003', 'AC-CDG-002', 3, 1, NULL),
  ('b0000000-0000-0000-0000-000000000004', 'AC-DPS-001', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000004', 'AC-DPS-002', 4, 1, NULL),
  ('b0000000-0000-0000-0000-000000000005', 'AC-FCO-004', 2, 1, 'Skip-the-line included'),
  ('b0000000-0000-0000-0000-000000000005', 'AC-FCO-001', 3, 1, NULL),
  ('b0000000-0000-0000-0000-000000000006', 'AC-JFK-004', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000006', 'AC-JFK-003', 3, 1, NULL),
  ('b0000000-0000-0000-0000-000000000007', 'AC-BKK-001', 2, 1, NULL),
  ('b0000000-0000-0000-0000-000000000007', 'AC-BKK-003', 4, 1, NULL),
  ('b0000000-0000-0000-0000-000000000008', 'AC-CUZ-004', 3, 1, 'After acclimatisation day');

-- ---------- media (one cover per package) ----------
INSERT INTO public.package_media (package_id, uploaded_by, media_type, url, thumbnail_url, caption, is_cover, sort_order)
SELECT p.package_id, p.creator_id, 'image',
  'https://picsum.photos/seed/' || p.package_id::text || '-' || n || '/1200/800',
  'https://picsum.photos/seed/' || p.package_id::text || '-' || n || '/400/267',
  CASE WHEN n = 1 THEN 'Cover — ' || p.title ELSE p.destination_city || ' snapshot ' || n END,
  n = 1, n
FROM public.travel_packages p, generate_series(1, 3) n
WHERE p.package_id::text LIKE 'b0000000-%';

-- ---------- detail-page fields (live packages) ----------
UPDATE public.travel_packages SET tags = ARRAY['food', 'culture', 'city'], max_group_size = 8
  WHERE package_id = 'b0000000-0000-0000-0000-000000000001';
UPDATE public.travel_packages SET tags = ARRAY['adventure', 'outdoors'], max_group_size = 10
  WHERE package_id = 'b0000000-0000-0000-0000-000000000002';
UPDATE public.travel_packages SET tags = ARRAY['city', 'romance', 'art'], max_group_size = 6
  WHERE package_id = 'b0000000-0000-0000-0000-000000000003';

INSERT INTO public.package_days (package_id, day_number, title, summary) VALUES
  ('b0000000-0000-0000-0000-000000000001', 1, 'Arrive in Tokyo', 'Land at Narita, check in near Shinjuku and ease in with an evening izakaya crawl.'),
  ('b0000000-0000-0000-0000-000000000001', 2, 'Markets & old Tokyo', 'Tsukiji outer market breakfast, then a guided walk through Yanaka''s backstreets.'),
  ('b0000000-0000-0000-0000-000000000001', 3, 'Cooking class day', 'Hands-on morning cooking class with a market visit; free evening.'),
  ('b0000000-0000-0000-0000-000000000002', 1, 'Arrive in Queenstown', 'Fly into ZQN, lakefront check-in and a sunset gondola ride.'),
  ('b0000000-0000-0000-0000-000000000002', 2, 'Adrenaline day one', 'Ziplines in the morning, jet boat on the Shotover in the afternoon.'),
  ('b0000000-0000-0000-0000-000000000003', 1, 'Bonjour Paris', 'Arrive at CDG, drop bags and take a golden-hour Seine river cruise.'),
  ('b0000000-0000-0000-0000-000000000003', 2, 'Galleries & food walk', 'Musée d''Orsay in the morning, evening patisserie and wine walk in Le Marais.');

-- ---------- approvals ----------
INSERT INTO public.package_approvals (package_id, admin_id, action, rejection_reason, actioned_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '26 days'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '19 days'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '11 days'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '7 days'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '6 days'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000004', 'rejected', 'Pricing does not cover listed inclusions; itinerary missing arrival-day logistics. Please revise and resubmit.', now() - interval '5 days');

-- ---------- AI suggestions ----------
INSERT INTO public.ai_suggestions (package_id, prompt, suggestion_text, status) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'User asked for one more evening option in Tokyo',
   'Add a Golden Gai bar-hopping night on day 4 (~$95 AUD) — a high-rated nightlife pick that fits the food & culture theme.', 'accepted'),
  ('b0000000-0000-0000-0000-000000000004', 'Balance relaxation vs activity across 10 days',
   'Alternate spa/yoga days with day trips; keep days 5 and 9 unplanned as free days.', 'pending'),
  ('b0000000-0000-0000-0000-000000000006', 'Check pacing of 5-day NYC itinerary',
   'Pacing is tight: day 2 has 11h of scheduled activities and there is no buffer before the JFK departure. Move the observation deck to day 3 morning.', 'dismissed'),
  ('b0000000-0000-0000-0000-000000000008', 'Altitude concerns for Cusco arrivals',
   'Schedule nothing strenuous for the first 36 hours; add a coca-tea welcome and a gentle city walk only.', 'accepted');

-- ---------- reviews (live packages only, unique per customer) ----------
INSERT INTO public.package_reviews (package_id, customer_id, rating, comment) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 5, 'The cooking class alone was worth it. Perfectly paced week.'),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 4.5, 'Brilliant food picks. Hotel was a little far from the action.'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 4, 'Great adrenaline mix, though weather cancelled one activity.'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 5, 'Best trip I''ve done. The hike on day 3 is unmissable.'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 4.5, 'Felt like a local weekend, not a tourist sprint.');

-- ---------- feasibility rules ----------
INSERT INTO public.feasibility_rules (rule_id, rule_description, is_active, rule_priority) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Total scheduled activity hours per day must not exceed 10.', TRUE, 1),
  ('f0000000-0000-0000-0000-000000000002', 'First and last days of a package must have at most one activity (travel buffer).', TRUE, 2),
  ('f0000000-0000-0000-0000-000000000003', 'Hotel nights must equal package duration_days minus 1 or match exactly.', FALSE, 3);

COMMIT;
