/**
 * Seed FIRMS codes from existing JSON data into Supabase.
 *
 * Usage:
 *   node supabase/scripts/seed_firms.js
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seedFirms() {
  const filePath = path.join(__dirname, '../../public/data/firms_codes_with_coordinates.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const firms = JSON.parse(raw);

  console.log(`Loaded ${firms.length} FIRMS codes from JSON`);

  // Clean address strings (remove newlines and extra whitespace)
  const rows = firms.map((f) => ({
    firms_code: f.firmsCode,
    name: f.name,
    facility_type: f.facilityType || 'TERMINAL',
    city: f.city,
    state: f.state,
    address: f.address ? f.address.replace(/\n\s+/g, ' ').trim() : null,
    latitude: f.latitude || null,
    longitude: f.longitude || null,
  }));

  // Insert in batches of 100
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('firms_codes')
      .upsert(batch, { onConflict: 'firms_code' });

    if (error) {
      console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`Inserted batch ${i / BATCH_SIZE + 1} (${inserted}/${rows.length})`);
    }
  }

  console.log(`Done. ${inserted} FIRMS codes seeded.`);
}

seedFirms().catch(console.error);
