import { selectActiveConfig } from '../../lib/email-dispatch/select-config.js';

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}`); }
};

// Stub Supabase client that returns a predetermined result for the chain
//   svc.from(table).select(cols).eq(col,val).eq(col,val).order(col, opts)
function stub(returnData, returnError = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: async () => ({ data: returnData, error: returnError }),
  };
  return { from: () => chain };
}

// ── Gate 7 branch-match path ──
await (async () => {
  const svc = stub([
    { id: 'cfg-default', branch_id: null, priority: 0 },
    { id: 'cfg-branchA', branch_id: 'branch-A', priority: 10 },
    { id: 'cfg-branchB', branch_id: 'branch-B', priority: 20 },
  ]);
  const r = await selectActiveConfig(svc, 'tenant-1', 'branch-A');
  check('branch-match wins when load has matching branch_id', r?.id === 'cfg-branchA');
})();

// ── Falls back to tenant-default when branch has no match ──
await (async () => {
  const svc = stub([
    { id: 'cfg-default', branch_id: null, priority: 0 },
    { id: 'cfg-branchA', branch_id: 'branch-A', priority: 10 },
  ]);
  const r = await selectActiveConfig(svc, 'tenant-1', 'branch-Z');
  check('falls back to tenant-default (branch_id=null) when no branch match', r?.id === 'cfg-default');
})();

// ── Falls back to tenant-default when load has no branch ──
await (async () => {
  const svc = stub([
    { id: 'cfg-default', branch_id: null, priority: 0 },
    { id: 'cfg-branchA', branch_id: 'branch-A', priority: 10 },
  ]);
  const r = await selectActiveConfig(svc, 'tenant-1', null);
  check('unbranched load gets tenant-default', r?.id === 'cfg-default');
})();

// ── Priority ordering: when branch-default absent, first row is fallback ──
await (async () => {
  const svc = stub([
    { id: 'cfg-branchA', branch_id: 'branch-A', priority: 5 },
    { id: 'cfg-branchB', branch_id: 'branch-B', priority: 10 },
  ]);
  const r = await selectActiveConfig(svc, 'tenant-1', null);
  check('no branch_id=null config → returns first (priority=5)', r?.id === 'cfg-branchA');
})();

// ── No configs returns null ──
await (async () => {
  const svc = stub([]);
  const r = await selectActiveConfig(svc, 'tenant-1', 'branch-A');
  check('returns null when tenant has no configs', r === null);
})();

// ── Error bubbles ──
await (async () => {
  const svc = stub(null, { message: 'boom' });
  try {
    await selectActiveConfig(svc, 'tenant-1', null);
    check('throws when supabase errors', false);
  } catch (e) {
    check('throws when supabase errors', /selectActiveConfig failed: boom/.test(e.message));
  }
})();

// ── Branch-match preferred over tenant-default even when default has higher priority ──
await (async () => {
  const svc = stub([
    { id: 'cfg-branchA', branch_id: 'branch-A', priority: 99 },
    { id: 'cfg-default', branch_id: null, priority: 0 },
  ]);
  const r = await selectActiveConfig(svc, 'tenant-1', 'branch-A');
  check('branch-match wins regardless of priority vs tenant-default', r?.id === 'cfg-branchA');
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
