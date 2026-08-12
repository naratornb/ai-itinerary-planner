// RLS verification for 0003_rls_policies.sql.
// Run ONLY after 0003 is applied by the pipeline:  node scripts/rls.check.mjs
// Uses the anon key + optional demo logins; makes no schema changes.
// The only durable write is one package_approvals audit row (no delete policy exists).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(url && anonKey, 'SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env');

const anon = createClient(url, anonKey);
const ok = (name) => console.log(`PASS  ${name}`);

// (a) anon sees only live packages
{
  const { data, error } = await anon.from('travel_packages').select('package_id,status');
  assert.ifError(error);
  assert(data.length > 0, 'expected at least one live package visible to anon');
  assert(data.every((p) => p.status === 'live'), `anon saw non-live statuses: ${[...new Set(data.map((p) => p.status))]}`);
  ok('anon sees only live travel_packages');
}

// (b) anon embeds creator profile + media on a live package
{
  const { data, error } = await anon
    .from('travel_packages')
    .select('package_id,title,creator:profiles!travel_packages_creator_id_fkey(full_name),package_media(*)')
    .limit(1)
    .single();
  assert.ifError(error);
  assert(data.creator?.full_name, 'embedded creator profile has no full_name');
  ok('anon embeds creator profile (full_name present) and package_media');
}

// (b2) package_days (0005): anon sees days of live packages only, cannot insert
{
  const { data: livePkgs, error: e0 } = await anon.from('travel_packages').select('package_id');
  assert.ifError(e0);
  const liveIds = new Set(livePkgs.map((p) => p.package_id));
  const { data, error } = await anon.from('package_days').select('package_id,day_number');
  assert.ifError(error);
  assert(data.length > 0, 'expected at least one package_days row visible to anon');
  assert(data.every((d) => liveIds.has(d.package_id)), 'anon saw package_days of a non-live package');
  ok('anon sees package_days of live packages only');

  const { error: insErr } = await anon
    .from('package_days')
    .insert({ package_id: [...liveIds][0], day_number: 99, title: 'rls-probe' });
  assert(insErr, 'anon insert into package_days unexpectedly succeeded');
  ok('anon insert into package_days rejected');
}

// (c) anon cannot insert
{
  const { error } = await anon
    .from('travel_packages')
    .insert({ title: 'rls-probe', base_price_aud: 1, creator_id: '00000000-0000-0000-0000-000000000000' });
  assert(error, 'anon insert into travel_packages unexpectedly succeeded');
  ok('anon insert into travel_packages rejected');
}

// (d) role checks — skipped gracefully if demo logins are absent
const PASSWORD = 'Password123!';
async function login(email) {
  const c = createClient(url, anonKey);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  return error ? null : c;
}

const [mia, casey, admin] = await Promise.all(
  ['mia@example.com', 'casey@example.com', 'admin@example.com'].map(login)
);

if (!mia || !casey || !admin) {
  console.log('SKIPPED  demo logins absent — owner/admin checks not run');
} else {
  const miaId = (await mia.auth.getUser()).data.user.id;
  const { data: miaPkg, error: e1 } = await mia
    .from('travel_packages').select('package_id,title').eq('creator_id', miaId).limit(1).single();
  assert.ifError(e1);
  assert(miaPkg, 'mia has no package to test with');

  // casey updating mia's package → 0 rows
  {
    const { data, error } = await casey
      .from('travel_packages').update({ title: 'hijacked' }).eq('package_id', miaPkg.package_id).select();
    assert.ifError(error);
    assert.equal(data.length, 0, 'casey updated mia\'s package');
    ok('casey cannot update mia\'s package (0 rows)');
  }

  // mia updating own → 1 row, then restore
  {
    const { data, error } = await mia
      .from('travel_packages').update({ title: miaPkg.title + ' *' }).eq('package_id', miaPkg.package_id).select();
    assert.ifError(error);
    assert.equal(data.length, 1, 'mia could not update her own package');
    const { error: e2 } = await mia
      .from('travel_packages').update({ title: miaPkg.title }).eq('package_id', miaPkg.package_id);
    assert.ifError(e2);
    ok('mia updates own package (title restored)');
  }

  const adminId = (await admin.auth.getUser()).data.user.id;

  // casey inserting an approval → fails
  {
    const { error } = await casey.from('package_approvals')
      .insert({ package_id: miaPkg.package_id, admin_id: adminId, action: 'approved' });
    assert(error, 'non-admin inserted a package_approvals row');
    ok('casey cannot insert package_approvals');
  }

  // admin inserting an approval with own id → succeeds
  // ponytail: no DELETE policy on package_approvals, so this leaves one audit row per run
  {
    const { error } = await admin.from('package_approvals')
      .insert({ package_id: miaPkg.package_id, admin_id: adminId, action: 'approved', rejection_reason: 'rls.check.mjs probe' });
    assert.ifError(error);
    ok('admin inserts package_approvals (audit row left in place)');
  }
}

console.log('RLS checks complete');
