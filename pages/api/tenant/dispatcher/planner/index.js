import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { applyBranchFilter, shouldFilterByBranch } from '../../../../../lib/branch-filter';
import { getBucket } from '../../../../../lib/dispatcher/moveBuckets';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL], res)) return;

  const { date, driver_search, branch_id, include_inactive } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
  }

  const svc = getServiceClient();

  // ── Drivers ───────────────────────────────────────────────────────────
  let driverQuery = svc
    .from('drivers')
    .select('id, name, first_name, last_name, phone, truck_number, status, eld_snapshot')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  driverQuery = applyBranchFilter(driverQuery, ctx);
  if (branch_id) driverQuery = driverQuery.eq('branch_id', branch_id);

  if (include_inactive !== '1') {
    driverQuery = driverQuery.eq('status', 'active');
  }
  if (driver_search && driver_search.trim()) {
    // Escape SQL wildcards (%, _) so user-typed literal "%" doesn't turn
    // into a wildcard; strip PostgREST delimiters (,()) which would break
    // the `.or()` parser. A trailing backslash would escape our closing %,
    // so normalize it first.
    const q = driver_search
      .trim()
      .replace(/\\/g, '\\\\')
      .replace(/([%_])/g, '\\$1')
      .replace(/[,()]/g, ' ');
    if (q) {
      driverQuery = driverQuery.or(
        `name.ilike.%${q}%,truck_number.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`
      );
    }
  }

  const { data: drivers, error: driversErr } = await driverQuery;
  if (driversErr) return res.status(500).json({ error: driversErr.message });

  // ── Moves on the given date (assigned) + unassigned pool ──────────────
  // One query returns both sets; we partition after fetch.
  let moveQuery = svc
    .from('order_container_moves')
    .select(
      `
      id, tenant_id, order_id, sequence, move_type,
      driver_id, truck_id, chassis_id,
      status, started_at, completed_at, scheduled_date, sort_order,
      assigned_at, tracking_status, last_ping_at, session_started_at, ping_count,
      order:orders!order_container_moves_order_id_fkey(
        id, order_number, container_number, container_size, container_type,
        load_type, customer_reference,
        last_free_day, container_at_port, empty_ready_for_return_at, branch_id,
        status, deleted_at, actual_delivery_at
      ),
      chassis:equipment_chassis(id, chassis_number),
      events:order_routing_events!order_routing_events_move_id_fkey(
        id, sequence, event_type, location_id, location_name, city, state,
        scheduled_at, arrived_at, departed_at
      )
      `
    )
    .eq('tenant_id', ctx.tenantId);

  // Either: scheduled on this date (assigned moves shown on grid)
  // OR: unassigned AND created in the last 30 days (right-rail pool).
  //
  // The 30-day recency window keeps the unassigned pool bounded for tenants
  // who accumulate ancient never-assigned moves. Real-world drayage moves
  // almost always get scheduled within days of container arrival — a move
  // that's been unassigned for 30+ days is either abandoned or a data bug,
  // and should be resolved via Load Detail rather than the planner pool.
  // Adjust the window (or remove entirely) if a tenant has a legitimate
  // long-dwell workflow.
  const UNASSIGNED_WINDOW_DAYS = 30;
  const unassignedCutoff = new Date(
    Date.now() - UNASSIGNED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  // Safety limit: cap at 500 rows to protect against runaway payload even
  // with the recency filter in place (sudden backlog spikes, etc).
  moveQuery = moveQuery
    .or(
      `scheduled_date.eq.${date},and(driver_id.is.null,created_at.gte.${unassignedCutoff})`
    )
    .order('sort_order', { ascending: true })
    .limit(500);

  const { data: moves, error: movesErr } = await moveQuery;
  if (movesErr) return res.status(500).json({ error: movesErr.message });

  // Mirror the dispatcher Load Board's lifecycle filter so the planner only
  // shows moves whose parent order is actually on the board:
  //   - soft-deleted orders are hidden (deleted_at IS NOT NULL)
  //   - completed/cancelled orders are hidden UNLESS finished today
  //     (the "Finished Today" KPI surface relies on this one-day grace)
  // Kept in JS (not SQL) so we stay consistent with the loads-index endpoint,
  // which also does this post-fetch. See pages/dispatcher/index.js
  // passesLifecycleFilter + pages/api/tenant/loads/index.js line ~282.
  function passesLifecycleFilter(order) {
    if (order.deleted_at != null) return false;
    if (!['completed', 'cancelled'].includes(order.status)) return true;
    const finishedAt = order.actual_delivery_at;
    if (!finishedAt) return false;
    const finished = new Date(finishedAt);
    const today = new Date();
    return (
      finished.getFullYear() === today.getFullYear() &&
      finished.getMonth() === today.getMonth() &&
      finished.getDate() === today.getDate()
    );
  }

  // Branch scoping via the joined orders row
  const branchFilterActive = shouldFilterByBranch(ctx);
  const branchScoped = (moves || []).filter((m) => {
    if (!m.order) return false;
    if (!passesLifecycleFilter(m.order)) return false;
    if (branch_id && m.order.branch_id !== branch_id) return false;
    // applyBranchFilter on the outer query only scopes drivers, not moves —
    // do the branch check on the order directly for parity. Admins and
    // super_admins bypass (shouldFilterByBranch returns false for them).
    if (branchFilterActive) {
      return m.order.branch_id == null || ctx.branchIds.includes(m.order.branch_id);
    }
    return true;
  });

  // Partition assigned vs unassigned
  const assigned = branchScoped.filter((m) => m.driver_id != null && m.scheduled_date === date);
  const unassigned = branchScoped.filter((m) => m.driver_id == null);

  // ── Build movesByDriverId (sorted by sort_order, then sequence) ────────
  const driverIdSet = new Set(drivers.map((d) => d.id));
  const movesByDriverId = {};
  for (const d of drivers) movesByDriverId[d.id] = [];
  for (const m of assigned) {
    if (!driverIdSet.has(m.driver_id)) continue; // driver filtered out by search/inactive
    movesByDriverId[m.driver_id].push(m);
  }
  for (const arr of Object.values(movesByDriverId)) {
    arr.sort((a, b) => {
      const aa = a.sort_order ?? 1e9;
      const bb = b.sort_order ?? 1e9;
      if (aa !== bb) return aa - bb;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
  }

  // ── Bucket unassigned moves via the shared util ───────────────────────
  const unassignedBuckets = { atPort: [], deliveries: [], return: [], other: [] };
  for (const m of unassigned) {
    const b = getBucket(m);
    if (b != null) unassignedBuckets[b].push(m);
  }

  // ── Derive meta (ETA / Truck / Chassis / Size) for each driver row ────
  // Rule: current = oldest in_progress move for the date; fallback = earliest pending/dispatched.
  const driversOut = drivers.map((d) => {
    const rows = movesByDriverId[d.id] || [];
    const inProgress = rows.find((m) => m.status === 'in_progress');
    const next = rows.find((m) => m.status === 'pending' || m.status === 'dispatched');
    const ref = inProgress || next || null;
    const pickup = ref?.events?.find((e) => e.event_type === 'pickup');

    return {
      id: d.id,
      name: d.name || [d.first_name, d.last_name].filter(Boolean).join(' '),
      short_code: initials(d.name || [d.first_name, d.last_name].filter(Boolean).join(' ')),
      truck_number: d.truck_number,
      status: d.status,
      current_move_id: inProgress?.id || null,
      next_move_id: next?.id || null,
      derived: {
        eta: pickup?.scheduled_at
          ? new Date(pickup.scheduled_at).toISOString().slice(11, 16) // HH:MM UTC
          : null,
        truck_number: d.truck_number || null,
        chassis_number: ref?.chassis?.chassis_number || null,
        container_size: ref?.order?.container_size || null,
      },
      eld: d.eld_snapshot && Object.keys(d.eld_snapshot).length > 0 ? d.eld_snapshot : null,
    };
  });

  return res.status(200).json({
    date,
    drivers: driversOut,
    movesByDriverId,
    unassignedBuckets,
  });
}

function initials(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '');
}
