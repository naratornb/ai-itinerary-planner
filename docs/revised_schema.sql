-- ============================================================
-- Flight Centre Influencer Marketplace — Revised DB Schema
-- Group 51 | ERD Revision based on Project Proposal
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. USERS  (enhanced from original)
--    Added: full_name, role, avatar_url
--    Role values: 'influencer' | 'admin' | 'customer'
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id           BIGINT        PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  email        TEXT          NOT NULL UNIQUE,
  full_name    TEXT,
  role         TEXT          NOT NULL DEFAULT 'influencer'
                             CHECK (role IN ('influencer', 'admin', 'customer')),
  avatar_url   TEXT,
  is_admin     BOOLEAN       NOT NULL DEFAULT FALSE,  -- kept for backward compat
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. INFLUENCER_PROFILES  (NEW)
--    Extended creator data — 1:1 with users (role='influencer')
-- ─────────────────────────────────────────────
CREATE TABLE influencer_profiles (
  profile_id      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio             TEXT,
  social_handle   TEXT,
  follower_count  BIGINT        DEFAULT 0,
  specialty       TEXT,         -- e.g. 'adventure', 'luxury', 'family'
  verified        BOOLEAN       NOT NULL DEFAULT FALSE
);

-- ─────────────────────────────────────────────
-- 3. FLIGHTS  (enhanced from original)
--    Fixed: departure_datetime was TEXT → TIMESTAMPTZ
--    Added: arrival_datetime, duration_mins
-- ─────────────────────────────────────────────
CREATE TABLE flights (
  flight_id           TEXT          PRIMARY KEY,
  airline             TEXT          NOT NULL,
  origin              TEXT          NOT NULL,
  destination         TEXT          NOT NULL,
  departure_datetime  TIMESTAMPTZ   NOT NULL,   -- FIX: was TEXT
  arrival_datetime    TIMESTAMPTZ,              -- NEW
  duration_mins       INTEGER,                  -- NEW
  cabin_class         TEXT,
  price_aud           BIGINT        NOT NULL
);

-- ─────────────────────────────────────────────
-- 4. HOTELS  (enhanced from original)
--    Added: amenities
-- ─────────────────────────────────────────────
CREATE TABLE hotels (
  hotel_id              TEXT          PRIMARY KEY,
  hotel_name            TEXT          NOT NULL,
  city                  TEXT          NOT NULL,
  country               TEXT          NOT NULL,
  star_rating           FLOAT8,
  room_type             TEXT,
  amenities             TEXT,                   -- NEW: comma-separated or JSON string
  price_per_night_aud   BIGINT        NOT NULL
);

-- ─────────────────────────────────────────────
-- 5. ACTIVITIES  (enhanced from original)
--    Added: duration_hours
-- ─────────────────────────────────────────────
CREATE TABLE activities (
  activity_id    TEXT          PRIMARY KEY,
  activity_name  TEXT          NOT NULL,
  city           TEXT          NOT NULL,
  category       TEXT,
  price_aud      BIGINT        NOT NULL,
  rating         FLOAT8,
  suitable_for   TEXT,
  duration_hours FLOAT8                         -- NEW: e.g. 2.5 hours
);

-- ─────────────────────────────────────────────
-- 6. TRAVEL_PACKAGES  (NEW — CORE ENTITY)
--    The central table linking everything together.
--    status values: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'live' | 'archived'
-- ─────────────────────────────────────────────
CREATE TABLE travel_packages (
  package_id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT          NOT NULL,
  description         TEXT,
  destination_city    TEXT,
  destination_country TEXT,
  duration_days       INTEGER,
  base_price_aud      BIGINT        NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','pending_review','approved','rejected','live','archived')),
  suitable_for        TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  submitted_at        TIMESTAMPTZ,              -- set when influencer hits "Submit for Review"
  published_at        TIMESTAMPTZ               -- set when package goes LIVE
);

-- ─────────────────────────────────────────────
-- 7. PACKAGE_FLIGHTS  (NEW — junction)
--    Links a travel package to one or more flight segments
-- ─────────────────────────────────────────────
CREATE TABLE package_flights (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID    NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  flight_id       TEXT    NOT NULL REFERENCES flights(flight_id) ON DELETE RESTRICT,
  day_number      INTEGER,   -- which day of the itinerary
  sequence_order  INTEGER,   -- order within a day
  notes           TEXT
);

-- ─────────────────────────────────────────────
-- 8. PACKAGE_HOTELS  (NEW — junction)
--    Links a travel package to one or more hotel stays
-- ─────────────────────────────────────────────
CREATE TABLE package_hotels (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID    NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  hotel_id        TEXT    NOT NULL REFERENCES hotels(hotel_id) ON DELETE RESTRICT,
  check_in_day    INTEGER,
  check_out_day   INTEGER,
  nights          INTEGER,
  notes           TEXT
);

-- ─────────────────────────────────────────────
-- 9. PACKAGE_ACTIVITIES  (NEW — junction)
--    Links a travel package to one or more activities
-- ─────────────────────────────────────────────
CREATE TABLE package_activities (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID    NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  activity_id     TEXT    NOT NULL REFERENCES activities(activity_id) ON DELETE RESTRICT,
  day_number      INTEGER,
  sequence_order  INTEGER,
  notes           TEXT
);

-- ─────────────────────────────────────────────
-- 10. PACKAGE_MEDIA  (NEW)
--     Photos and videos attached to a travel package (FR-I-102)
--     media_type: 'photo' | 'video'
-- ─────────────────────────────────────────────
CREATE TABLE package_media (
  media_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     UUID          NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  uploaded_by    BIGINT        NOT NULL REFERENCES users(id),
  media_type     TEXT          NOT NULL CHECK (media_type IN ('photo', 'video')),
  url            TEXT          NOT NULL,
  thumbnail_url  TEXT,
  caption        TEXT,
  is_cover       BOOLEAN       NOT NULL DEFAULT FALSE,
  uploaded_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 11. PACKAGE_APPROVALS  (NEW)
--     Audit log of admin approve/reject actions (FR-A-100/101/102)
--     action: 'approved' | 'rejected'
-- ─────────────────────────────────────────────
CREATE TABLE package_approvals (
  approval_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        UUID          NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  admin_id          BIGINT        NOT NULL REFERENCES users(id),
  action            TEXT          NOT NULL CHECK (action IN ('approved', 'rejected')),
  rejection_reason  TEXT,         -- required if action = 'rejected' (enforce in app layer)
  actioned_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 12. AI_SUGGESTIONS  (NEW)
--     Log of all AI recommendations generated during package creation (FR-I-101, FR-I-107)
--     suggestion_type: 'destination' | 'flight' | 'hotel' | 'activity' | 'itinerary' | 'feasibility'
-- ─────────────────────────────────────────────
CREATE TABLE ai_suggestions (
  suggestion_id      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id         UUID          NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  suggestion_type    TEXT          NOT NULL,
  prompt_context     TEXT,         -- what the user was doing when the suggestion was triggered
  suggestion_content JSONB,        -- full AI response payload
  accepted           BOOLEAN,      -- did the influencer accept this suggestion?
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 13. PACKAGE_REVIEWS  (NEW)
--     Customer ratings and comments on live packages (FR-C-100, FR-C-101)
-- ─────────────────────────────────────────────
CREATE TABLE package_reviews (
  review_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   UUID          NOT NULL REFERENCES travel_packages(package_id) ON DELETE CASCADE,
  customer_id  BIGINT        NOT NULL REFERENCES users(id),
  rating       FLOAT8        NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (package_id, customer_id)  -- one review per customer per package
);

-- ─────────────────────────────────────────────
-- 14. FEASIBILITY_RULES  (NEW)
--     Store feasibility rules for reference
-- ─────────────────────────────────────────────
CREATE TABLE feasibility_rules (
  rule_id    		UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_description	text,
  is_active  		bool		  NOT NULL DEFAULT 0,
  rule_priority     BIGINT        NOT NULL,
  updated_at   		TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at   		TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id)
);

-- ─────────────────────────────────────────────
-- INDEXES (performance)
-- ─────────────────────────────────────────────
CREATE INDEX idx_packages_creator    ON travel_packages(creator_id);
CREATE INDEX idx_packages_status     ON travel_packages(status);
CREATE INDEX idx_approvals_package   ON package_approvals(package_id);
CREATE INDEX idx_ai_suggestions_pkg  ON ai_suggestions(package_id);
CREATE INDEX idx_media_package       ON package_media(package_id);
CREATE INDEX idx_reviews_package     ON package_reviews(package_id);
