import { resolveFromDisplayName } from '../../lib/email-dispatch/resolve-from-display-name.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Precedence chain: template > config > tenant > platform floor
check(
  'tier 1: template override wins',
  resolveFromDisplayName(
    { from_display_name: 'Acme Billing' },
    { from_display_name: 'Acme Trucking' },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Billing'
);

check(
  'tier 2: config wins when template null',
  resolveFromDisplayName(
    { from_display_name: null },
    { from_display_name: 'Acme Trucking' },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Trucking'
);

check(
  'tier 3: tenant.name wins when template + config null',
  resolveFromDisplayName(
    { from_display_name: null },
    { from_display_name: null },
    { name: 'Acme Logistics LLC' }
  ) === 'Acme Logistics LLC'
);

check(
  'tier 4: platform floor when everything null',
  resolveFromDisplayName(null, null, null) === 'DrayageDirect Notifications'
);

// Empty string + whitespace = fall through
check(
  'empty string falls through',
  resolveFromDisplayName(
    { from_display_name: '' },
    { from_display_name: 'Acme Trucking' },
    { name: 'X' }
  ) === 'Acme Trucking'
);

check(
  'whitespace-only falls through',
  resolveFromDisplayName(
    { from_display_name: '   ' },
    { from_display_name: 'Acme Trucking' },
    { name: 'X' }
  ) === 'Acme Trucking'
);

// Trims the winner
check(
  'trims winning value',
  resolveFromDisplayName(
    { from_display_name: '  Acme Billing  ' },
    null,
    null
  ) === 'Acme Billing'
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
