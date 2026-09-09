// Syncs the AI-contextual feasibility rules into Supabase's feasibility_rules
// table via the service-role key: upserts every row in FALLBACK_RULES, then
// deletes any DB row whose rule_code is no longer in that list (e.g. a rule
// that got moved to a code check or retired). RLS on this table is
// admin-write-only (same reason apps/api/app/core.py's _admin_headers()
// exists for catalog tables) — the anon/authenticated keys can't insert.
//
// apps/web/lib/feasibility.ts's FALLBACK_RULES is the deploy-time baseline
// (used only if the DB is empty/unreachable) — this script is the only way
// rule rows get into the DB; supabase/seed/02_users_packages.sql no longer
// seeds this table. A live wording tweak can be made directly in the DB
// (Studio or here) without touching FALLBACK_RULES; only structural changes
// (adding/removing/renumbering a rule) need FALLBACK_RULES updated too.
//
// Run:  apps/web/node_modules/.bin/tsx scripts/seed-feasibility-rules.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { FALLBACK_RULES } from '../apps/web/lib/feasibility.ts';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(url && serviceRoleKey, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');

const admin = createClient(url, serviceRoleKey);

const rows = FALLBACK_RULES.map((rule, i) => ({
  rule_code: rule.rule_code,
  rule_name: rule.rule_name,
  rule_description: rule.rule_description,
  is_active: true,
  rule_priority: i + 1,
}));

const { data, error } = await admin
  .from('feasibility_rules')
  .upsert(rows, { onConflict: 'rule_code' })
  .select('rule_code');

if (error) {
  console.error('Upsert failed:', error.message);
  process.exit(1);
}
console.log(`Upserted ${data.length} feasibility_rules rows: ${data.map((r) => r.rule_code).join(', ')}`);

const activeCodes = FALLBACK_RULES.map((r) => r.rule_code);
const { data: pruned, error: pruneError } = await admin
  .from('feasibility_rules')
  .delete()
  .not('rule_code', 'in', `(${activeCodes.join(',')})`)
  .select('rule_code');

if (pruneError) {
  console.error('Prune failed:', pruneError.message);
  process.exit(1);
}
if (pruned.length > 0) {
  console.log(`Pruned ${pruned.length} stale row(s): ${pruned.map((r) => r.rule_code).join(', ')}`);
}
