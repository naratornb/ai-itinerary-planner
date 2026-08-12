#!/usr/bin/env node
// Generates supabase/seed/{flights,hotels,activities}.csv and 01_catalog.sql.
// Deterministic (seeded PRNG) — rerunning produces identical output.
// Usage: node scripts/generate-catalog-seed.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed');
mkdirSync(OUT, { recursive: true });

// mulberry32 seeded PRNG
let s = 0x5eed;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const rf = (lo, hi, dp = 1) => +(lo + rnd() * (hi - lo)).toFixed(dp);

// [name, country, IATA, lat, lon, priceIndex(0.6 cheap – 1.6 pricey), hub]
const CITIES = [
  ['Sydney', 'Australia', 'SYD', -33.95, 151.18, 1.25, 1],
  ['Melbourne', 'Australia', 'MEL', -37.67, 144.84, 1.2, 1],
  ['Brisbane', 'Australia', 'BNE', -27.38, 153.12, 1.1, 1],
  ['Perth', 'Australia', 'PER', -31.94, 115.97, 1.1, 0],
  ['Cairns', 'Australia', 'CNS', -16.88, 145.75, 1.0, 0],
  ['Auckland', 'New Zealand', 'AKL', -37.0, 174.79, 1.1, 1],
  ['Queenstown', 'New Zealand', 'ZQN', -45.02, 168.74, 1.15, 0],
  ['Tokyo', 'Japan', 'NRT', 35.77, 140.39, 1.2, 1],
  ['Osaka', 'Japan', 'KIX', 34.43, 135.24, 1.1, 1],
  ['Kyoto', 'Japan', 'UKY', 34.99, 135.75, 1.15, 0],
  ['Sapporo', 'Japan', 'CTS', 42.78, 141.69, 1.0, 0],
  ['Seoul', 'South Korea', 'ICN', 37.46, 126.44, 1.05, 1],
  ['Busan', 'South Korea', 'PUS', 35.18, 128.94, 0.9, 0],
  ['Taipei', 'Taiwan', 'TPE', 25.08, 121.23, 0.95, 1],
  ['Hong Kong', 'China', 'HKG', 22.31, 113.91, 1.3, 1],
  ['Shanghai', 'China', 'PVG', 31.14, 121.81, 1.05, 1],
  ['Bangkok', 'Thailand', 'BKK', 13.69, 100.75, 0.7, 1],
  ['Chiang Mai', 'Thailand', 'CNX', 18.77, 98.96, 0.6, 0],
  ['Phuket', 'Thailand', 'HKT', 8.11, 98.31, 0.75, 0],
  ['Singapore', 'Singapore', 'SIN', 1.36, 103.99, 1.35, 1],
  ['Kuala Lumpur', 'Malaysia', 'KUL', 2.75, 101.71, 0.7, 1],
  ['Denpasar', 'Indonesia', 'DPS', -8.75, 115.17, 0.65, 1],
  ['Jakarta', 'Indonesia', 'CGK', -6.13, 106.66, 0.65, 0],
  ['Hanoi', 'Vietnam', 'HAN', 21.22, 105.81, 0.6, 0],
  ['Ho Chi Minh City', 'Vietnam', 'SGN', 10.82, 106.66, 0.6, 1],
  ['Da Nang', 'Vietnam', 'DAD', 16.04, 108.2, 0.6, 0],
  ['Manila', 'Philippines', 'MNL', 14.51, 121.02, 0.65, 0],
  ['Delhi', 'India', 'DEL', 28.57, 77.1, 0.55, 1],
  ['Mumbai', 'India', 'BOM', 19.09, 72.87, 0.6, 0],
  ['Colombo', 'Sri Lanka', 'CMB', 7.18, 79.88, 0.6, 0],
  ['Dubai', 'United Arab Emirates', 'DXB', 25.25, 55.36, 1.3, 1],
  ['Doha', 'Qatar', 'DOH', 25.27, 51.61, 1.25, 1],
  ['Istanbul', 'Turkey', 'IST', 41.28, 28.75, 0.8, 1],
  ['Cairo', 'Egypt', 'CAI', 30.12, 31.41, 0.55, 0],
  ['Marrakech', 'Morocco', 'RAK', 31.61, -8.03, 0.65, 0],
  ['Cape Town', 'South Africa', 'CPT', -33.96, 18.6, 0.75, 0],
  ['Nairobi', 'Kenya', 'NBO', -1.32, 36.93, 0.7, 0],
  ['London', 'United Kingdom', 'LHR', 51.47, -0.45, 1.45, 1],
  ['Edinburgh', 'United Kingdom', 'EDI', 55.95, -3.37, 1.15, 0],
  ['Paris', 'France', 'CDG', 49.01, 2.55, 1.4, 1],
  ['Nice', 'France', 'NCE', 43.66, 7.22, 1.3, 0],
  ['Rome', 'Italy', 'FCO', 41.8, 12.24, 1.15, 1],
  ['Venice', 'Italy', 'VCE', 45.51, 12.35, 1.3, 0],
  ['Florence', 'Italy', 'FLR', 43.81, 11.2, 1.2, 0],
  ['Barcelona', 'Spain', 'BCN', 41.3, 2.08, 1.1, 1],
  ['Madrid', 'Spain', 'MAD', 40.47, -3.57, 1.05, 0],
  ['Valencia', 'Spain', 'VLC', 39.49, -0.48, 0.9, 0],
  ['Lisbon', 'Portugal', 'LIS', 38.77, -9.13, 0.95, 0],
  ['Porto', 'Portugal', 'OPO', 41.24, -8.68, 0.85, 0],
  ['Amsterdam', 'Netherlands', 'AMS', 52.31, 4.76, 1.35, 1],
  ['Berlin', 'Germany', 'BER', 52.36, 13.5, 1.1, 0],
  ['Prague', 'Czech Republic', 'PRG', 50.1, 14.26, 0.85, 0],
  ['Vienna', 'Austria', 'VIE', 48.11, 16.57, 1.15, 0],
  ['Krakow', 'Poland', 'KRK', 50.08, 19.78, 0.7, 0],
  ['Athens', 'Greece', 'ATH', 37.94, 23.94, 0.9, 0],
  ['Santorini', 'Greece', 'JTR', 36.4, 25.48, 1.2, 0],
  ['Reykjavik', 'Iceland', 'KEF', 63.99, -22.61, 1.5, 0],
  ['New York', 'United States', 'JFK', 40.64, -73.78, 1.55, 1],
  ['Los Angeles', 'United States', 'LAX', 33.94, -118.41, 1.4, 1],
  ['San Francisco', 'United States', 'SFO', 37.62, -122.38, 1.5, 0],
  ['Honolulu', 'United States', 'HNL', 21.32, -157.92, 1.35, 0],
  ['Vancouver', 'Canada', 'YVR', 49.19, -123.18, 1.25, 1],
  ['Mexico City', 'Mexico', 'MEX', 19.44, -99.07, 0.7, 0],
  ['Cancun', 'Mexico', 'CUN', 21.04, -86.87, 0.85, 0],
  ['Cusco', 'Peru', 'CUZ', -13.54, -71.94, 0.65, 0],
  ['Buenos Aires', 'Argentina', 'EZE', -34.82, -58.54, 0.7, 0],
  ['Rio de Janeiro', 'Brazil', 'GIG', -22.81, -43.25, 0.75, 0],
  ['Medellin', 'Colombia', 'MDE', 6.16, -75.42, 0.6, 0],
];
const cityByCode = Object.fromEntries(CITIES.map((c) => [c[2], c]));

// Airlines: code → name, and which hub codes they serve from
const AIRLINES = [
  ['QF', 'Qantas', ['SYD', 'MEL', 'BNE']],
  ['VA', 'Virgin Australia', ['SYD', 'MEL', 'BNE']],
  ['JQ', 'Jetstar', ['SYD', 'MEL', 'BNE']],
  ['NZ', 'Air New Zealand', ['AKL']],
  ['JL', 'Japan Airlines', ['NRT', 'KIX']],
  ['NH', 'ANA', ['NRT', 'KIX']],
  ['KE', 'Korean Air', ['ICN']],
  ['BR', 'EVA Air', ['TPE']],
  ['CX', 'Cathay Pacific', ['HKG']],
  ['MU', 'China Eastern', ['PVG']],
  ['TG', 'Thai Airways', ['BKK']],
  ['SQ', 'Singapore Airlines', ['SIN']],
  ['MH', 'Malaysia Airlines', ['KUL']],
  ['GA', 'Garuda Indonesia', ['DPS']],
  ['VN', 'Vietnam Airlines', ['SGN']],
  ['AI', 'Air India', ['DEL']],
  ['EK', 'Emirates', ['DXB']],
  ['QR', 'Qatar Airways', ['DOH']],
  ['TK', 'Turkish Airlines', ['IST']],
  ['BA', 'British Airways', ['LHR']],
  ['AF', 'Air France', ['CDG']],
  ['AZ', 'ITA Airways', ['FCO']],
  ['IB', 'Iberia', ['BCN']],
  ['KL', 'KLM', ['AMS']],
  ['AA', 'American Airlines', ['JFK', 'LAX']],
  ['UA', 'United Airlines', ['LAX', 'JFK']],
  ['AC', 'Air Canada', ['YVR']],
];

const haversineKm = (a, b) => {
  const R = 6371, d = Math.PI / 180;
  const dLat = (b[3] - a[3]) * d, dLon = (b[4] - a[4]) * d;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[3] * d) * Math.cos(b[3] * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// ---------- flights ----------
// Build routes: every airline connects each of its hubs to a spread of destinations.
const hubs = CITIES.filter((c) => c[6]);
const routes = [];
for (const [code, name, bases] of AIRLINES) {
  for (const base of bases) {
    const origin = cityByCode[base];
    // destinations: all hubs + a few non-hubs, distance-capped for realism
    const dests = CITIES.filter((c) => c[2] !== base)
      .filter((c) => c[6] || rnd() < 0.25)
      .filter(() => rnd() < 0.35);
    for (const dest of dests.slice(0, 6)) routes.push({ code, name, origin, dest });
  }
}

const START = Date.UTC(2026, 0, 1), END = Date.UTC(2027, 11, 31);
const DAY = 86400000;
const flights = [];
let fnum = 100;
for (const r of routes) {
  const km = haversineKm(r.origin, r.dest);
  const durOut = Math.round(km / 850 * 60 + 40);
  const weekdays = pick([[1], [3], [5], [1, 4], [2, 5], [0, 3], [2, 6], [1, 3, 5]]);
  const depH = ri(6, 22), depM = pick([0, 15, 30, 45]);
  const cabin = rnd() < 0.15 ? 'business' : rnd() < 0.25 ? 'premium_economy' : 'economy';
  const cabinMult = { economy: 1, premium_economy: 1.8, business: 3.2 }[cabin];
  const base = (120 + km * 0.11) * cabinMult;
  const num = fnum++; // stable per route
  for (let t = START; t <= END; t += DAY) {
    const dt = new Date(t);
    if (!weekdays.includes(dt.getUTCDay())) continue;
    if (rnd() > 0.5) continue; // sparse: skip ~half the scheduled days
    const month = dt.getUTCMonth();
    const seasonal = 1 + 0.18 * Math.sin((month - 5) / 12 * 2 * Math.PI) + (rnd() - 0.5) * 0.12;
    const dep = Date.UTC(dt.getUTCFullYear(), month, dt.getUTCDate(), depH, depM);
    const arr = dep + durOut * 60000;
    const ymd = dt.toISOString().slice(0, 10).replace(/-/g, '');
    flights.push({
      flight_id: `${r.code}${num}-${ymd}`,
      airline: r.name,
      origin: `${r.origin[0]} (${r.origin[2]})`,
      origin_country: r.origin[1],
      destination: `${r.dest[0]} (${r.dest[2]})`,
      destination_country: r.dest[1],
      departure_datetime: new Date(dep).toISOString(),
      arrival_datetime: new Date(arr).toISOString(),
      duration_mins: durOut,
      cabin_class: cabin,
      price_aud: Math.round(base * seasonal),
    });
  }
}

// ---------- hotels ----------
const BRANDS = [
  ['Hilton', 5], ['Marriott', 5], ['Hyatt Regency', 5], ['InterContinental', 5],
  ['Shangri-La', 5], ['Four Seasons', 5], ['Sheraton', 4], ['Crowne Plaza', 4],
  ['Radisson Blu', 4], ['Novotel', 4], ['Holiday Inn', 3], ['Mercure', 3],
  ['ibis', 2], ['ibis Styles', 2], ['Travelodge', 2],
];
const BOUTIQUE = ['The Grand {c} Hotel', 'Hotel {c} Central', 'The {c} Boutique',
  '{c} Harbour Suites', 'The Old Town Inn {c}', '{c} Garden Residence',
  'The Terrace {c}', 'Casa {c}', 'Villa {c}', 'The {c} House'];
const ROOMS = ['Standard Double', 'Deluxe King', 'Twin Room', 'Junior Suite',
  'Executive Suite', 'Family Room', 'Superior Queen'];
const AMEN = ['wifi', 'pool', 'gym', 'spa', 'breakfast included', 'bar',
  'restaurant', 'airport shuttle', 'parking', 'rooftop terrace', 'kids club', 'beach access'];
const hotels = [];
for (const c of CITIES) {
  const [city, country, code, , , idx] = c;
  const n = ri(30, 38);
  for (let i = 1; i <= n; i++) {
    let name, stars;
    if (i <= BRANDS.length && rnd() < 0.6) {
      const [brand, tier] = BRANDS[i - 1];
      name = `${brand} ${city}`;
      stars = tier === 5 ? rf(4.5, 5.0) : tier === 4 ? rf(3.5, 4.5) : tier === 3 ? rf(3.0, 4.0) : rf(2.0, 3.0);
    } else {
      name = pick(BOUTIQUE).replace('{c}', city);
      stars = rf(2.5, 5.0);
    }
    const amen = [...AMEN].sort(() => rnd() - 0.5).slice(0, ri(3, 6)).join(', ');
    hotels.push({
      hotel_id: `HT-${code}-${String(i).padStart(3, '0')}`,
      hotel_name: name,
      city, country,
      star_rating: stars,
      room_type: pick(ROOMS),
      amenities: amen,
      price_per_night_aud: Math.round((60 + stars * stars * 22) * idx * rf(0.8, 1.3, 2)),
    });
  }
}
// dedupe boutique name collisions within a city
const seenHotel = new Set();
for (const h of hotels) {
  let key = h.city + h.hotel_name;
  if (seenHotel.has(key)) h.hotel_name += ` ${pick(['II', 'Annex', 'East', 'West', 'Riverside'])}`;
  seenHotel.add(h.city + h.hotel_name);
}

// ---------- activities ----------
const ACT = [
  ['{c} Street Food Walking Tour', 'food & drink', [45, 120], 'couples, foodies', [2.5, 4]],
  ['{c} Cooking Class with Local Chef', 'food & drink', [80, 180], 'couples, families', [3, 4]],
  ['{c} Night Market & Tapas Crawl', 'food & drink', [50, 110], 'adults, groups', [3, 4]],
  ['Historic {c} City Walking Tour', 'culture', [25, 70], 'everyone', [2, 3.5]],
  ['{c} Museum & Gallery Pass', 'culture', [30, 90], 'everyone', [3, 6]],
  ['{c} Old Town Photography Tour', 'culture', [60, 140], 'couples, solo travellers', [2, 4]],
  ['{c} Sunset Cruise', 'water', [70, 200], 'couples, families', [2, 3]],
  ['Snorkelling Day Trip from {c}', 'water', [90, 250], 'families, adventure seekers', [6, 8]],
  ['{c} Kayak & Coastline Tour', 'water', [65, 150], 'active travellers', [3, 4]],
  ['{c} Countryside Day Trip', 'day trip', [110, 280], 'everyone', [8, 10]],
  ['Wine & Vineyard Tour near {c}', 'day trip', [130, 320], 'adults', [6, 8]],
  ['{c} Hidden Villages Small-Group Tour', 'day trip', [100, 260], 'small groups', [7, 9]],
  ['{c} Mountain Hike & Viewpoints', 'adventure', [55, 160], 'active travellers', [4, 8]],
  ['{c} Bike Tour', 'adventure', [45, 110], 'active travellers, families', [3, 4]],
  ['{c} Zipline & Ropes Adventure', 'adventure', [80, 190], 'adventure seekers', [2, 4]],
  ['{c} Rooftop Bar Crawl', 'nightlife', [60, 130], 'adults, groups', [3, 4]],
  ['{c} Live Music & Dinner Evening', 'nightlife', [90, 220], 'couples, adults', [3, 4]],
  ['{c} Craft & Artisan Workshop', 'class', [70, 160], 'everyone', [2, 3]],
  ['{c} Language & Culture Crash Course', 'class', [40, 90], 'solo travellers', [2, 3]],
  ['{c} Wellness & Spa Half-Day', 'wellness', [110, 300], 'couples', [3, 5]],
  ['{c} Sunrise Yoga Session', 'wellness', [30, 70], 'everyone', [1, 2]],
  ['{c} Hop-On Hop-Off Bus Pass', 'sightseeing', [40, 80], 'families, everyone', [4, 8]],
  ['{c} River & Canal Cruise', 'sightseeing', [35, 95], 'everyone', [1, 2.5]],
  ['{c} Observation Deck Skip-the-Line', 'sightseeing', [35, 85], 'families', [1, 2]],
];
const activities = [];
for (const c of CITIES) {
  const [city, country, code, , , idx] = c;
  const n = ri(34, 44);
  const used = new Set();
  for (let i = 1; i <= n; i++) {
    const t = ACT[(i - 1) % ACT.length];
    let name = t[0].replace('{c}', city);
    if (used.has(name)) name += ` — ${pick(['Morning', 'Afternoon', 'Evening', 'Private', 'Small Group', 'Premium'])} Edition`;
    used.add(name);
    activities.push({
      activity_id: `AC-${code}-${String(i).padStart(3, '0')}`,
      activity_name: name,
      city,
      country,
      category: t[1],
      price_aud: Math.round(ri(t[2][0], t[2][1]) * idx),
      rating: rf(3.4, 5.0),
      suitable_for: t[3],
      duration_hours: rf(t[4][0], t[4][1]),
    });
  }
}

// ---------- output ----------
const csvCell = (v) => {
  const str = String(v);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};
const toCsv = (rows) => {
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n';
};
const sqlVal = (v) => typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const toInserts = (table, rows) => {
  const cols = Object.keys(rows[0]);
  const out = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
      .map((r) => `(${cols.map((k) => sqlVal(r[k])).join(',')})`).join(',\n');
    out.push(`INSERT INTO public.${table} (${cols.join(', ')}) VALUES\n${chunk}\nON CONFLICT DO NOTHING;`);
  }
  return out.join('\n\n');
};

writeFileSync(join(OUT, 'flights.csv'), toCsv(flights));
writeFileSync(join(OUT, 'hotels.csv'), toCsv(hotels));
writeFileSync(join(OUT, 'activities.csv'), toCsv(activities));
writeFileSync(join(OUT, '01_catalog.sql'), `-- Catalog seed: generated by scripts/generate-catalog-seed.mjs — do not edit by hand.
-- ${flights.length} flights, ${hotels.length} hotels, ${activities.length} activities.
-- Run: psql "$DATABASE_URL" -f supabase/seed/01_catalog.sql
BEGIN;

${toInserts('flights', flights)}

${toInserts('hotels', hotels)}

${toInserts('activities', activities)}

COMMIT;
`);
console.log(`flights=${flights.length} hotels=${hotels.length} activities=${activities.length} -> ${OUT}`);
