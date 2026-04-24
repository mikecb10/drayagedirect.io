import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';
import { getVisibleEntityIds } from '../../../../lib/branch-filter';

const VALID_TYPES = ['customer', 'terminal', 'warehouse', 'yard', 'final_destination'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

    const { type, status, search, branch_id } = req.query;

    // Branch filtering for M:N (customer_branches junction)
    const visibleIds = await getVisibleEntityIds(svc, ctx, 'customer_branches', 'customer_id');

    let query = svc
      .from('customers')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    // If branch-scoped, show branch-assigned orgs + orgs with no branch assignment
    if (visibleIds !== null) {
      // Get IDs of orgs that have ANY branch assignment
      const { data: allAssigned } = await svc
        .from('customer_branches')
        .select('customer_id')
        .eq('tenant_id', ctx.tenantId);
      const assignedSet = new Set((allAssigned || []).map((r) => r.customer_id));
      // visibleIds = orgs assigned to user's branches
      // unassigned = orgs with no branch at all (backward compat)
      // We need to fetch all and filter in JS since OR with subquery is complex
      // This is acceptable — org lists are typically <1000 rows
    }

    // Explicit branch filter from admin UI
    if (branch_id) {
      const { data: branchCusts } = await svc
        .from('customer_branches')
        .select('customer_id')
        .eq('branch_id', branch_id)
        .eq('tenant_id', ctx.tenantId);
      const custIds = (branchCusts || []).map((r) => r.customer_id);
      if (custIds.length > 0) {
        query = query.in('id', custIds);
      } else {
        return res.status(200).json({ organizations: [], stats: { customer: 0, terminal: 0, warehouse: 0, yard: 0, final_destination: 0, total: 0 } });
      }
    }

    if (status) query = query.eq('status', status);
    if (type && VALID_TYPES.includes(type)) query = query.contains('customer_types', [type]);
    if (search) query = query.ilike('name', `%${search}%`);

    let { data, error } = await query;

    // Post-fetch branch filtering for M:N
    if (visibleIds !== null && !branch_id && data) {
      const visibleSet = new Set(visibleIds);
      const { data: allAssigned } = await svc
        .from('customer_branches')
        .select('customer_id')
        .eq('tenant_id', ctx.tenantId);
      const assignedSet = new Set((allAssigned || []).map((r) => r.customer_id));
      // Show: orgs in user's branches + orgs with no branch assignment at all
      data = data.filter((org) => visibleSet.has(org.id) || !assignedSet.has(org.id));
    }

    if (error) return res.status(500).json({ error: error.message });

    // Compute stats by type
    const stats = { customer: 0, terminal: 0, warehouse: 0, yard: 0, final_destination: 0, total: data.length };
    for (const org of data) {
      for (const t of org.customer_types || []) {
        if (stats[t] !== undefined) stats[t]++;
      }
    }

    return res.status(200).json({ organizations: data, stats });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'Name is required' });

    const types = Array.isArray(body.customer_types) && body.customer_types.length > 0
      ? body.customer_types.filter((t) => VALID_TYPES.includes(t))
      : ['customer'];

    const insertData = {
      tenant_id: ctx.tenantId,
      name: body.name,
      short_name: body.short_name || null,
      customer_types: types,
      profile_label: body.profile_label || null,
      tracking_status: body.tracking_status || null,
      market: body.market || null,
      mc_number: body.mc_number || null,
      address_line1: body.address_line1 || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      country: body.country || 'US',
      phone: body.phone || null,
      billing_email: body.billing_email || null,
      receiver_email: body.receiver_email || null,
      quickbooks_email: body.quickbooks_email || null,
      company_domain: body.company_domain || null,
      currency: body.currency || 'USD',
      payment_terms: body.payment_terms ?? 30,
      payment_term_method: body.payment_term_method || 'daily',
      payment_terms_from: body.payment_terms_from || 'invoice_date',
      credit_limit_cents: body.credit_limit_cents ?? null,
      account_hold: body.account_hold || false,
      office_hour_start: body.office_hour_start || null,
      office_hour_end: body.office_hour_end || null,
      main_contact_name: body.main_contact_name || null,
      main_phone: body.main_phone || null,
      secondary_contact_name: body.secondary_contact_name || null,
      secondary_phone: body.secondary_phone || null,
      organization_subtype: body.organization_subtype || null,
      portal_enabled: body.portal_enabled || false,
      portal_admin_email: body.portal_admin_email || null,
      can_edit_load: body.can_edit_load || false,
      tags: body.tags || null,
      notes: body.notes || null,
      status: 'active',
      // New fields from migration 027
      sales_agent: body.sales_agent || null,
      organization_subtypes: body.organization_subtypes || [],
      quickbooks_company_field: body.quickbooks_company_field || null,
      pay_type: body.pay_type || null,
      organization_tags: body.organization_tags || [],
      is_hazmat_certified: body.is_hazmat_certified || false,
      tir_optional: body.tir_optional || false,
      invoice_combination: body.invoice_combination || null,
      payment_terms_days: body.payment_terms_days ?? 30,
      portal_email: body.portal_email || null,
      terminal_market: body.terminal_market || null,
      tracking_status: body.tracking_status || false,
      // Geofence
      geofence_type: body.geofence_type || null,
      geofence_data: body.geofence_data || null,
      // Required documents
      required_documents: body.required_documents || [],
    };

    const { data, error } = await svc
      .from('customers')
      .insert(insertData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-seed 4 default groups for the new organization.
    // These are empty (no members) until admins populate them.
    // actorType='system' because seeding is automation following from
    // the human's org-creation action.
    const DEFAULT_GROUPS = [
      { name: 'Billing',            purpose: 'billing',            description: 'Default billing group -- receives invoice emails' },
      { name: 'Operations',         purpose: 'operations',         description: 'Default operations group -- receives operational notifications' },
      { name: 'Dispatch',           purpose: 'dispatch',           description: 'Default dispatch group -- receives dispatch notifications' },
      { name: 'Rate Confirmation',  purpose: 'rate_confirmation',  description: 'Default rate-confirmation group -- receives rate con emails' },
    ];

    const { error: seedErr } = await svc.from('organization_groups').insert(
      DEFAULT_GROUPS.map((g) => ({
        tenant_id: ctx.tenantId,
        organization_id: data.id,
        name: g.name,
        purpose: g.purpose,
        is_default_for_purpose: true,
        description: g.description,
      }))
    );

    if (seedErr) {
      // Non-fatal: the org was created successfully. Log the seed failure
      // and continue. Admin can manually create groups via GroupsTab.
      console.error(`Default-group seed failed for org ${data.id}:`, seedErr.message);
    } else {
      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'organization.default_groups_seeded',
        entityType: 'organization',
        entityId: data.id,
        newValues: { groups: DEFAULT_GROUPS.map((g) => g.name) },
        ipAddress: getClientIp(req),
        actorType: 'system',  // auto-seed = system action
      });
    }

    // Create branch assignments if branch_ids provided
    const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids.filter(Boolean) : [];
    if (branchIds.length > 0) {
      await svc.from('customer_branches').insert(
        branchIds.map((bid) => ({
          tenant_id: ctx.tenantId,
          customer_id: data.id,
          branch_id: bid,
        }))
      );
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'organization.create',
      entityType: 'organization',
      entityId: data.id,
      newValues: { name: data.name, customer_types: data.customer_types, branch_ids: branchIds },
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ organization: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
