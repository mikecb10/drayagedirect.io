import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/tariffs/[id]/charge-sets
 *
 * GET  — list charge sets for a tariff (with linked profiles + items)
 * POST — create a new charge set
 * PUT  — bulk replace all charge sets (full sync from the form)
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: tariffId } = req.query;
  const svc = getServiceClient();

  // Verify tariff belongs to tenant
  const { data: tariff } = await svc
    .from('tariffs')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', tariffId)
    .single();
  if (!tariff) return res.status(404).json({ error: 'Tariff not found' });

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('tariff_charge_sets')
      .select(`
        *,
        profiles:tariff_charge_set_profiles(
          *,
          charge_profile:charge_profiles(id, name, charge_name, unit_of_measure, tag, tags)
        ),
        items:tariff_charge_items(*),
        tags:tariff_charge_set_tags(*)
      `)
      .eq('tariff_id', tariffId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ charge_sets: data || [] });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};

    const { data: cs, error } = await svc
      .from('tariff_charge_sets')
      .insert({
        tenant_id: ctx.tenantId,
        tariff_id: tariffId,
        bill_to_mode: body.bill_to_mode || 'load_customer',
        bill_to_customer_id: body.bill_to_customer_id || null,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Link charge profiles
    if (body.profile_ids?.length > 0) {
      const profileLinks = body.profile_ids.map((pid) => ({
        charge_set_id: cs.id,
        charge_profile_id: pid,
      }));
      await svc.from('tariff_charge_set_profiles').insert(profileLinks);
    }

    // Add tags
    if (body.tags?.length > 0) {
      const tagRows = body.tags.map((t) => ({ charge_set_id: cs.id, tag: t }));
      await svc.from('tariff_charge_set_tags').insert(tagRows);
    }

    // Add one-off charge items
    if (body.items?.length > 0) {
      const itemRows = body.items.map((item) => ({
        charge_set_id: cs.id,
        name: item.name,
        charge_name: item.charge_name || null,
        unit_of_measure: item.unit_of_measure || 'fixed',
        amount_cents: item.amount_cents || 0,
        minimum_amount_cents: item.minimum_amount_cents || 0,
        free_units: item.free_units || 0,
        conditions: item.conditions || [],
      }));
      await svc.from('tariff_charge_items').insert(itemRows);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tariff_charge_set.create',
      entityType: 'tariff_charge_set',
      entityId: cs.id,
      newValues: { tariff_id: tariffId, bill_to_mode: cs.bill_to_mode },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ charge_set: cs });
  }

  if (req.method === 'PUT') {
    // Bulk sync — replace all charge sets for this tariff
    if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

    const { charge_sets: newSets = [] } = req.body;

    // Delete existing charge sets (cascades to profiles, items, tags via FK)
    await svc.from('tariff_charge_sets').delete().eq('tariff_id', tariffId);

    // Create new charge sets
    const created = [];
    for (const set of newSets) {
      const { data: cs, error } = await svc
        .from('tariff_charge_sets')
        .insert({
          tenant_id: ctx.tenantId,
          tariff_id: tariffId,
          bill_to_mode: set.bill_to_mode || 'load_customer',
          bill_to_customer_id: set.bill_to_customer_id || null,
          notes: set.notes || null,
        })
        .select()
        .single();

      if (error) continue;

      // Link profiles
      if (set.profile_ids?.length > 0) {
        const profileLinks = set.profile_ids.map((pid) => ({
          charge_set_id: cs.id,
          charge_profile_id: pid,
        }));
        await svc.from('tariff_charge_set_profiles').insert(profileLinks);
      }

      // Add tags
      if (set.tags?.length > 0) {
        const tagRows = set.tags.map((t) => ({ charge_set_id: cs.id, tag: t }));
        await svc.from('tariff_charge_set_tags').insert(tagRows);
      }

      // Add items
      if (set.items?.length > 0) {
        const itemRows = set.items.map((item) => ({
          charge_set_id: cs.id,
          name: item.name,
          charge_name: item.charge_name || null,
          unit_of_measure: item.unit_of_measure || 'fixed',
          amount_cents: item.amount_cents || 0,
          minimum_amount_cents: item.minimum_amount_cents || 0,
          free_units: item.free_units || 0,
          conditions: item.conditions || [],
        }));
        await svc.from('tariff_charge_items').insert(itemRows);
      }

      created.push(cs);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'tariff_charge_sets.sync',
      entityType: 'tariff',
      entityId: tariffId,
      newValues: { count: created.length },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ charge_sets: created });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
