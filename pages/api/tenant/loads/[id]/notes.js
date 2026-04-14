import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

const VALID_AUDIENCES = ['driver', 'billing', 'yard', 'load', 'terminal'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { audience } = req.query;
    let query = svc
      .from('order_notes')
      .select('*, author:users!order_notes_created_by_fkey(id, name, email)')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('created_at', { ascending: false });
    if (audience) query = query.eq('audience', audience);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ notes: data || [] });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const { audience, body, charge_set_id } = req.body || {};
    if (!VALID_AUDIENCES.includes(audience)) {
      return res.status(400).json({ error: 'Invalid audience' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Note body is required' });
    }

    const { data, error } = await svc
      .from('order_notes')
      .insert({
        tenant_id: ctx.tenantId,
        order_id: id,
        audience,
        charge_set_id: charge_set_id || null,
        body: body.trim(),
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.note_create',
      entityType: 'order',
      entityId: id,
      newValues: { audience, note_id: data.id, body: body.trim() },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ note: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
