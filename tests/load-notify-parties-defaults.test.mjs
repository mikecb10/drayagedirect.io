let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else      { console.log(`  ✗ ${name}`); failed++; }
}

const orgPatchModule = await import('../lib/notify-parties-validator.js');
const { validateDefaultNotifyParties } = orgPatchModule;

console.log('validateDefaultNotifyParties — input shape validation');

// Case 1: Valid array passes
{
  console.log('\nCase 1: Valid array passes');
  const out = validateDefaultNotifyParties([
    { type: 'group', id: '11111111-1111-1111-1111-111111111111', source_organization_id: '22222222-2222-2222-2222-222222222222' },
    { type: 'contact', id: '33333333-3333-3333-3333-333333333333' },
  ]);
  check('valid: returns array of length 2', Array.isArray(out) && out.length === 2);
}

// Case 2: Empty array passes
{
  console.log('\nCase 2: Empty array passes');
  const out = validateDefaultNotifyParties([]);
  check('empty: returns []', Array.isArray(out) && out.length === 0);
}

// Case 3: Missing type rejected
{
  console.log('\nCase 3: Entry missing type is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ id: 'x' }]); } catch { threw = true; }
  check('missing type: throws', threw);
}

// Case 4: Missing id rejected
{
  console.log('\nCase 4: Entry missing id is rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'group' }]); } catch { threw = true; }
  check('missing id: throws', threw);
}

// Case 5: Bad type value rejected
{
  console.log('\nCase 5: Bad type value rejected');
  let threw = false;
  try { validateDefaultNotifyParties([{ type: 'org', id: '11111111-1111-1111-1111-111111111111' }]); } catch { threw = true; }
  check('bad type: throws', threw);
}

// Case 6: Non-array rejected
{
  console.log('\nCase 6: Non-array rejected');
  let threw = false;
  try { validateDefaultNotifyParties({ type: 'group', id: 'x' }); } catch { threw = true; }
  check('non-array: throws', threw);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
