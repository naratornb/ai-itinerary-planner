-- Users, packages & related seed. Requires 01_catalog.sql applied first.
-- Run: psql "$DATABASE_URL" -f supabase/seed/02_users_packages.sql
-- All seed users: password "Password123!", emails end in @seed.local.
-- Rerunnable: deletes seed rows (cascades from auth.users / fixed package IDs) then reinserts.

BEGIN;

-- ---------- cleanup (rerun safety) ----------
DELETE FROM public.travel_packages WHERE package_id::text LIKE 'b0000000-%';
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

INSERT INTO public.influencer_profiles (user_id, bio, instagram_handle, follower_count, specialty, verified) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tokyo-based creator sharing food-first city guides across Asia.', '@mia.eats.world', 482000, 'food & culture', TRUE),
  ('a0000000-0000-0000-0000-000000000002', 'Adventure filmmaker chasing mountains, fjords and powder.', '@leo.outside', 213000, 'adventure', TRUE),
  ('a0000000-0000-0000-0000-000000000003', 'Budget-luxe European city breaks and hidden-gem itineraries.', '@aria.wanders', 96000, 'city breaks', FALSE);

-- ---------- travel packages ----------
-- statuses: 6 live, 2 approved, 1 pending_review, 1 rejected, 1 draft
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

-- Curated cover/gallery photography for the live marketplace cards (Unsplash CDN).
UPDATE public.package_media m
SET url = 'https://images.unsplash.com/' || v.photo || '?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1200',
    thumbnail_url = 'https://images.unsplash.com/' || v.photo || '?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=400'
FROM (VALUES
  ('b0000000-0000-0000-0000-000000000001', 1, 'photo-1573455494060-c5595004fb6c'),
  ('b0000000-0000-0000-0000-000000000002', 1, 'photo-1755446133354-96486cc15900'),
  ('b0000000-0000-0000-0000-000000000003', 1, 'photo-1502602898657-3e91760cbb34'),
  ('b0000000-0000-0000-0000-000000000009', 1, 'photo-1525625293386-3f8f99389edd'),
  ('b0000000-0000-0000-0000-000000000009', 2, 'photo-1508964942454-1a56651d54ac'),
  ('b0000000-0000-0000-0000-000000000009', 3, 'photo-1572583931138-82814cface17'),
  ('b0000000-0000-0000-0000-000000000010', 1, 'photo-1590559899731-a382839e5549'),
  ('b0000000-0000-0000-0000-000000000010', 2, 'photo-1480796927426-f609979314bd'),
  ('b0000000-0000-0000-0000-000000000010', 3, 'photo-1753159398866-e344efd8816c'),
  ('b0000000-0000-0000-0000-000000000011', 1, 'photo-1596422846543-75c6fc197f07'),
  ('b0000000-0000-0000-0000-000000000011', 2, 'photo-1569878698992-c6e8c84bdd4d'),
  ('b0000000-0000-0000-0000-000000000011', 3, 'photo-1670239510523-4bb105d27433')
) AS v(package_id, sort_order, photo)
WHERE m.package_id = v.package_id::uuid AND m.sort_order = v.sort_order;

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
INSERT INTO public.package_approvals (package_id, reviewer_id, decision, rejection_reason, reviewed_at) VALUES
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
-- Not seeded here — feasibility_rules is populated/kept in sync from
-- apps/web/lib/feasibility.ts's FALLBACK_RULES via `npm run seed:feasibility-rules`
-- (scripts/seed-feasibility-rules.mjs), which upserts by rule_code and prunes
-- anything no longer in FALLBACK_RULES. Run that after this seed file.

-- ---------- showcase packages (b...009–011) ----------
-- Complete, high-quality listings: every day filled, all activities noted,
-- AU departure AND return legs, hotel for the whole stay. Expected to pass
-- the publish-quality check at ~95/100.

INSERT INTO public.travel_packages (package_id, creator_id, title, description,
  destination_city, destination_country, duration_days, base_price_aud, status,
  suitable_for, submitted_at, published_at) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001',
   'Singapore in Six: Hawker Stalls to Skyline',
   'Six days from Melbourne into Singapore''s food halls, heritage quarters and rooftop bars — with a snorkelling day on the southern islands and a business-class flight home.',
   'Singapore', 'Singapore', 6, 9290, 'live', 'couples, foodies', now() - interval '20 days', now() - interval '17 days'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000003',
   'Osaka & Kansai: Ten Days of Kitchens, Temples & Neon',
   'A slow ten days out of Brisbane based in Namba — Osaka''s food streets, hands-on cooking, day trips to Kyoto and Nara, and one deliberate rest day.',
   'Osaka', 'Japan', 10, 8490, 'live', 'foodies, culture lovers', now() - interval '18 days', now() - interval '15 days'),
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001',
   'KL Weekender Plus: Seven Days, Three Cultures',
   'A week out of Sydney through Kuala Lumpur''s Malay, Chinese and Indian neighbourhoods — hawker breakfasts, a countryside escape, and rooftop nights over Bukit Bintang.',
   'Kuala Lumpur', 'Malaysia', 7, 6390, 'live', 'foodies, first-timers', now() - interval '12 days', now() - interval '9 days');

UPDATE public.travel_packages SET tags = ARRAY['food', 'city', 'culture'], max_group_size = 6
  WHERE package_id = 'b0000000-0000-0000-0000-000000000009';
UPDATE public.travel_packages SET tags = ARRAY['food', 'culture', 'japan'], max_group_size = 8
  WHERE package_id = 'b0000000-0000-0000-0000-000000000010';
UPDATE public.travel_packages SET tags = ARRAY['food', 'culture', 'value'], max_group_size = 10
  WHERE package_id = 'b0000000-0000-0000-0000-000000000011';

-- Round trips: outbound AU on day 1, return leg on the final day.
INSERT INTO public.package_flights (package_id, flight_id, day_number, sequence_order, notes) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'QF110-20261113', 1, 1, 'I always book the evening departure — you sleep on the plane and land with a full day ahead. Ask for a left-side window; the dawn approach over the strait is worth staying awake for.'),
  ('b0000000-0000-0000-0000-000000000009', 'SQ214-20261118', 6, 1, 'The business-class leg home is half the point of this trip. Pre-order through Book the Cook before you fly — the laksa beats anything on the regular menu.'),
  ('b0000000-0000-0000-0000-000000000010', 'QF112-20261113', 1, 1, 'The daytime QF112 lands mid-evening — drop your bags and walk straight into Dotonbori for a first takoyaki. Pick up an IC card at the airport before the train into town.'),
  ('b0000000-0000-0000-0000-000000000010', 'JL167-20261123', 10, 1, 'A late-morning departure means one last Kuromon coffee before the airport train. The Rapi:t express to KIX needs a seat reservation — sort it the night before.'),
  ('b0000000-0000-0000-0000-000000000011', 'QF103-20261021', 1, 1, 'Premium economy on the daytime QF103 earns the upgrade — you land late afternoon with energy left for the Bukit Bintang evening stroll. Right-side window for the coast on descent.'),
  ('b0000000-0000-0000-0000-000000000011', 'MH220-20261028', 7, 1, 'The morning MH220 gets you home by dinner. KLIA gates sit in a satellite terminal reached by train — leave the hotel twenty minutes earlier than feels necessary.');

INSERT INTO public.package_hotels (package_id, hotel_id, check_in_day, check_out_day, nights, notes) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'HT-SIN-003', 1, 7, 6, 'Superior Queen rooms on the higher floors are the quiet ones — ask for level 20 and up at check-in. The spa fills up after 6pm, so book your slot in the morning before heading out.'),
  ('b0000000-0000-0000-0000-000000000010', 'HT-KIX-002', 1, 11, 10, 'The Standard Double here is roomier than most Namba hotels at this price — request a courtyard-facing room if street noise bothers you. Breakfast is simple, but the miso is genuinely good.'),
  ('b0000000-0000-0000-0000-000000000011', 'HT-KUL-003', 1, 8, 7, 'The rooftop pool is the hidden rest stop of this trip — almost empty before 9am. The airport shuttle runs on the hour; confirm your seat at the front desk the night before you leave.');

INSERT INTO public.package_activities (package_id, activity_id, day_number, sequence_order, notes) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-004', 2, 1, 'Do this walk early — the civic district is empty before 9am and the light on the Chinatown shophouses is the best of the trip. The guide finishes near Chin Mee Chin, the proper kaya-toast coffee stop.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-023', 2, 2, 'Golden hour is the whole trick — the city lights switch on mid-cruise. Sit on the right side of the bumboat for the Marina Bay skyline reveal.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-001', 3, 1, 'Come hungry and let the guide order — the longest queue is usually the one worth joining. The carrot cake (it is actually radish) at Amoy is the plate locals argue about.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-003', 3, 2, 'Treat this as a graze, not a dinner — small plates, many stalls. The satay row at the end is the reward, and the sugarcane-juice stands beat the bottled drinks on price.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-008', 4, 1, 'The southern islands are calmest in the morning — you will be in the water before the day boats arrive. Reef-safe sunscreen is provided, but bring a long-sleeve rashie if you burn easily.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-020', 5, 1, 'Deliberately a half-day — after the island trip you will want the slow morning more than the massage. If you skip the spa entirely, this block doubles as the slot for a lazy Orchard Road brunch.'),
  ('b0000000-0000-0000-0000-000000000009', 'AC-SIN-016', 5, 2, 'Three rooftops, ordered by view — dress smart-casual and the door queues are painless. Skip cocktails at the first stop; the last bar makes them better and stays open latest.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-001', 2, 1, 'Kuromon before 10am is locals shopping; after 11 it is queues. Do the market first, then follow the guide to the knife shops on Sakai-suji — most will engrave while you wait.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-023', 2, 2, 'Twenty minutes of pure neon — it is kitschy and that is the point. Sit at the back of the boat for unobstructed photos of the Glico sign reflecting on the water.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-002', 3, 1, 'You flip your own okonomiyaki — the trick is confidence, not speed. The chef uses nagaimo yam in the batter, which is why it comes out lighter than the tourist version.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-006', 3, 2, 'The old town at golden hour is where Osaka drops the neon act. Any camera works — the guide knows which alley corners still catch the last light.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-010', 4, 1, 'A full day, but gently paced — two temples, lunch by the river, and you are back in Namba for dinner. Wear shoes you can slip off; tatami floors everywhere.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-004', 5, 1, 'The castle grounds are free — you only pay to go inside, and honestly the moat loop is the better walk. The museum quarter afterwards is where the morning gets interesting.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-005', 5, 2, 'The pass covers a dozen venues — pick two and do them properly instead of sprinting through five. The ukiyo-e collection is small but the best on the list.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-012', 6, 1, 'The deer are charming until they mob your senbei — feed them early while they are still polite. The hidden-villages leg after lunch is the part nobody else on the route does.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-021', 7, 1, 'Sunrise on the river resets your clock better than any lie-in — this is the deliberately light day. Mats and towels are provided; bring water and a layer for the walk back.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-020', 7, 2, 'A proper onsen-style soak after six days of walking — your legs need this. Tattoos should be covered (patches are provided), and the evening is intentionally left unplanned.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-014', 8, 1, 'The moat loop is flat and takes about an hour at dawdling pace — go before 10am while the paths are locals-only quiet. The melon-pan stand near the gate is the post-ride ritual.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-024', 8, 2, 'The skip-the-line entry earns its keep at dusk — the queue doubles between 6 and 7pm. Stay through blue hour; the neon switching on below is the actual show.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-018', 9, 1, 'Pick indigo dyeing for something wearable, the knife workshop for something you will use forever. Both instructors are third-generation — the stories are half the experience.'),
  ('b0000000-0000-0000-0000-000000000010', 'AC-KIX-017', 9, 2, 'The live-music izakaya is the real Namba send-off — arrive hungry, the set menu is generous. For a last drink after, the standing bar two doors down is where the chefs go.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-001', 2, 1, 'Jalan Alor wakes up early — the guide orders the classics, but ask for the char kway teow from the corner stall. It is the one the stallholders themselves eat at.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-024', 2, 2, 'Go up early in the trip for the lay of the city — the towers view works best in late-afternoon light. Hazy days still deliver; the skyline does the work.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-002', 3, 1, 'You pound your own rendang paste, and the roti canai flipping is harder than it looks. Come hungry — you eat everything you make, and it is a lot.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-004', 3, 2, 'Little India and Chinatown in one loop — the sari shops and incense makers are the stops people skip and should not. Bring cash; the best stalls do not take cards.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-010', 4, 1, 'Batu Caves before 9am beats both the heat and the crowds — 272 steps, and the monkeys own the railings. The firefly park after dark is the unexpected highlight.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-021', 5, 1, 'An early start that pays off — the hotel district is silent at dawn. All levels are welcome and the teacher adjusts everything; breakfast tastes better after.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-020', 5, 2, 'A half-day block you can split however you like — treatment, pool, or a nap. Book treatments for the earlier slots; the afternoon fills with hotel guests.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-003', 5, 3, 'A crawl, not a meal — small plates, many stops. The durian stand is the obvious choice; the apam balik pancake stall is the quiet star.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-023', 6, 1, 'The river-of-life cruise is gentler than the name suggests — a slow loop past the confluence where KL began. Evening departures catch the mist-and-light show at the mosque bend.'),
  ('b0000000-0000-0000-0000-000000000011', 'AC-KUL-016', 6, 2, 'Bukit Bintang rooftops after dark — dress codes are relaxed but flip-flops push it. The second bar has the towers view; linger there for the light show on the hour.');

INSERT INTO public.package_days (package_id, day_number, title, summary) VALUES
  ('b0000000-0000-0000-0000-000000000009', 1, 'Touchdown in the Lion City', 'Evening flight from Melbourne, early check-in near Orchard Road and a late hawker-centre supper.'),
  ('b0000000-0000-0000-0000-000000000009', 2, 'Old Singapore on foot', 'Heritage quarters in the morning, then a river cruise at golden hour.'),
  ('b0000000-0000-0000-0000-000000000009', 3, 'Eat like a local', 'Hawker breakfast tour, a hands-on cooking session, then the night markets.'),
  ('b0000000-0000-0000-0000-000000000009', 4, 'Southern islands', 'A full snorkelling day trip — the one big out-of-town day.'),
  ('b0000000-0000-0000-0000-000000000009', 5, 'Slow morning, skyline night', 'Spa half-day to recover, then a rooftop bar crawl to close out the trip.'),
  ('b0000000-0000-0000-0000-000000000009', 6, 'Last bites & fly home', 'Kaya-toast breakfast, a final souvenir run, then the evening SQ214 home in business.'),
  ('b0000000-0000-0000-0000-000000000010', 1, 'Arrive in Namba', 'Evening flight from Brisbane into KIX, transfer to Namba and a first Dotonbori wander.'),
  ('b0000000-0000-0000-0000-000000000010', 2, 'The kitchen of Japan', 'Kuromon market grazing, Dotonbori food crawl and a canal cruise under the neon.'),
  ('b0000000-0000-0000-0000-000000000010', 3, 'Cook Osaka', 'Okonomiyaki class in the morning, golden-hour photo walk in the old town.'),
  ('b0000000-0000-0000-0000-000000000010', 4, 'Kyoto day trip', 'A full-day excursion to Kyoto — back in Namba in time for dinner.'),
  ('b0000000-0000-0000-0000-000000000010', 5, 'Castle & museums', 'Osaka Castle on foot, then a museum pass for the afternoon.'),
  ('b0000000-0000-0000-0000-000000000010', 6, 'Nara & hidden villages', 'Deer park, great Buddha and the quiet villages behind the city.'),
  ('b0000000-0000-0000-0000-000000000010', 7, 'Rest day, done properly', 'Sunrise yoga, a half-day spa, and an evening left deliberately unplanned.'),
  ('b0000000-0000-0000-0000-000000000010', 8, 'Osaka on two wheels', 'Morning castle-moat bike loop, then the observation deck at dusk.'),
  ('b0000000-0000-0000-0000-000000000010', 9, 'Craft & a farewell dinner', 'A hands-on workshop, then live music and dinner in Namba.'),
  ('b0000000-0000-0000-0000-000000000010', 10, 'Fly home', 'Slow breakfast, a last Kuromon pass for gifts, and JL167 back to Brisbane.'),
  ('b0000000-0000-0000-0000-000000000011', 1, 'Arrive in KL', 'Morning departure from Sydney, afternoon check-in and an evening stroll through Bukit Bintang.'),
  ('b0000000-0000-0000-0000-000000000011', 2, 'Street food & skylines', 'Jalan Alor hawker breakfast, then the observation deck for the towers view.'),
  ('b0000000-0000-0000-0000-000000000011', 3, 'Cook & heritage', 'Rendang and roti canai class, then a heritage walk through Little India and Chinatown.'),
  ('b0000000-0000-0000-0000-000000000011', 4, 'Countryside escape', 'Batu Caves and the firefly park — the full day out of the city.'),
  ('b0000000-0000-0000-0000-000000000011', 5, 'Wellness & night markets', 'Sunrise yoga, a spa half-day, and a graze through the night markets.'),
  ('b0000000-0000-0000-0000-000000000011', 6, 'River & rooftops', 'The river-of-life cruise, then a last-night rooftop bar hop.'),
  ('b0000000-0000-0000-0000-000000000011', 7, 'Fly home', 'Final roti breakfast, pack up, and MH220 back to Sydney.');

INSERT INTO public.package_media (package_id, uploaded_by, media_type, url, thumbnail_url, caption, is_cover, sort_order)
SELECT p.package_id, p.creator_id, 'image',
  'https://picsum.photos/seed/' || p.package_id::text || '-' || n || '/1200/800',
  'https://picsum.photos/seed/' || p.package_id::text || '-' || n || '/400/267',
  CASE WHEN n = 1 THEN 'Cover — ' || p.title ELSE p.destination_city || ' snapshot ' || n END,
  n = 1, n
FROM public.travel_packages p, generate_series(4, 6) n
WHERE p.package_id::text IN (
  'b0000000-0000-0000-0000-000000000009',
  'b0000000-0000-0000-0000-000000000010',
  'b0000000-0000-0000-0000-000000000011');

INSERT INTO public.package_approvals (package_id, reviewer_id, decision, rejection_reason, reviewed_at) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '18 days'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '16 days'),
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000004', 'approved', NULL, now() - interval '10 days');

INSERT INTO public.package_reviews (package_id, customer_id, rating, comment) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000005', 5, 'Every meal was a highlight — the hawker tour set the tone for the whole week.'),
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000006', 5, 'Business class home after the island day was the perfect ending.'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000005', 5, 'The rest day halfway through was genius — came home rested for once.'),
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000006', 4.5, 'Namba as a base was spot on. Kyoto day trip ran like clockwork.'),
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000005', 5, 'Batu Caves day and the night markets were the standouts.'),
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000006', 4.5, 'Great value week — the hotel shuttle made arrivals painless.');

COMMIT;
