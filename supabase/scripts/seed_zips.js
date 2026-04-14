/**
 * Seed US ZIP codes into Supabase.
 *
 * For now, seeds from the existing small dataset.
 * TODO: Replace with a full US ZIP code dataset (~42,000 entries).
 *       Free sources: https://simplemaps.com/data/us-zips
 *
 * Usage:
 *   node supabase/scripts/seed_zips.js
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

async function seedZips() {
  const filePath = path.join(__dirname, '../../public/data/zip_lat_lon.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const zips = JSON.parse(raw);

  console.log(`Loaded ${zips.length} ZIP codes from JSON`);

  const rows = zips.map((z) => ({
    zip: z.zip,
    city: z.city || 'Unknown',
    state: z.state || 'Unknown',
    latitude: z.latitude || z.lat,
    longitude: z.longitude || z.lon,
  }));

  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('zip_codes')
      .upsert(batch, { onConflict: 'zip' });

    if (error) {
      console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`Inserted batch ${i / BATCH_SIZE + 1} (${inserted}/${rows.length})`);
    }
  }

  console.log(`Done. ${inserted} ZIP codes seeded.`);
  console.log('\nNOTE: Only sample ZIP codes loaded. For production, download the full');
  console.log('US ZIP dataset from https://simplemaps.com/data/us-zips and update this script.');
}

seedZips().catch(console.error);
