import { requireTenantUser, getServiceClient } from '../../../lib/tenant-api';

const EDITABLE_FIELDS = [
  'column_order',
  'hidden_columns',
  'frozen_columns',
  'column_widths',
  'saved_filters',
  'row_density',
  'compact_mode',
  'skip_routing_confirmations',
  'open_routing_on_dispatch',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    // Try to fetch existing prefs
    let { data, error } = await svc
      .from('user_dispatcher_preferences')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-create default row on first visit
    if (!data) {
      const { data: created, error: createErr } = await svc
        .from('user_dispatcher_preferences')
        .insert({
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          column_order: [],
          hidden_columns: [],
          frozen_columns: ['order_number', 'customer', 'container_number', 'status'],
          column_widths: {},
          saved_filters: {},
          row_density: 'comfortable',
        })
        .select()
        .single();
      if (createErr) return res.status(500).json({ error: createErr.message });
      data = created;
    }

    return res.status(200).json({ preferences: data });
  }

  if (req.method === 'PUT') {
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // Upsert: create if missing, update otherwise
    const { data, error } = await svc
      .from('user_dispatcher_preferences')
      .upsert(
        {
          tenant_id: ctx.tenantId,
          user_id: ctx.userId,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ preferences: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
