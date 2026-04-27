/**
 * Pure helper — list load notify parties hydrated with names/org info.
 * Exported here so it can be unit-tested without mocking the full Next.js
 * auth stack. The GET handler at
 * pages/api/tenant/loads/[id]/notify-parties/index.js imports this.
 */
export async function listLoadNotifyParties(svc, ctx, loadId) {
  const { data: rows } = await svc
    .from('load_notify_parties')
    .select('id, party_type, party_id, source, source_organization_id, created_at, updated_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('load_id', loadId);

  const groupIds = (rows || []).filter((r) => r.party_type === 'group').map((r) => r.party_id);
  const contactIds = (rows || []).filter((r) => r.party_type === 'contact').map((r) => r.party_id);
  const orgIds = Array.from(new Set((rows || []).map((r) => r.source_organization_id).filter(Boolean)));

  // Parallel batch hydration
  const [{ data: groups }, { data: contacts }, { data: orgs }, { data: groupMembers }] = await Promise.all([
    groupIds.length
      ? svc.from('organization_groups').select('id, name').eq('tenant_id', ctx.tenantId).in('id', groupIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? svc.from('organization_contacts').select('id, name, email').eq('tenant_id', ctx.tenantId).in('id', contactIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? svc.from('customers').select('id, name').eq('tenant_id', ctx.tenantId).in('id', orgIds)
      : Promise.resolve({ data: [] }),
    groupIds.length
      ? svc.from('organization_group_members').select('group_id').eq('tenant_id', ctx.tenantId).in('group_id', groupIds)
      : Promise.resolve({ data: [] }),
  ]);

  const groupById = Object.fromEntries((groups || []).map((g) => [g.id, g]));
  const contactById = Object.fromEntries((contacts || []).map((c) => [c.id, c]));
  const orgById = Object.fromEntries((orgs || []).map((o) => [o.id, o]));
  const memberCountByGroup = (groupMembers || []).reduce((acc, m) => {
    acc[m.group_id] = (acc[m.group_id] || 0) + 1;
    return acc;
  }, {});

  const parties = (rows || []).map((r) => {
    const base = {
      id: r.id,
      party_type: r.party_type,
      party_id: r.party_id,
      source: r.source,
      source_organization_id: r.source_organization_id,
      source_organization_name: r.source_organization_id ? (orgById[r.source_organization_id]?.name || null) : null,
    };
    if (r.party_type === 'group') {
      const g = groupById[r.party_id];
      return { ...base, name: g?.name || null, member_count: memberCountByGroup[r.party_id] || 0 };
    }
    const c = contactById[r.party_id];
    return { ...base, name: c?.name || null, email: c?.email || null };
  });

  return { parties };
}

/**
 * Pure helper — add a single notify party to a load. Verifies tenant
 * scope on the referenced group/contact before insert. Returns
 * { row } on success.
 *
 * @param svc       Supabase service client
 * @param ctx       { tenantId, userId }
 * @param loadId    UUID of the load
 * @param body      { party_type, party_id, source?, source_organization_id? }
 * @param ipAddress request IP for audit
 * @param logger    optional audit logger (defaults to logTenantAction)
 */
export async function addLoadNotifyParty(svc, ctx, loadId, body, ipAddress, logger) {
  const { party_type, party_id, source, source_organization_id } = body || {};

  if (party_type !== 'group' && party_type !== 'contact') {
    const e = new Error('Invalid party_type — must be "group" or "contact"');
    e.statusCode = 400;
    throw e;
  }
  if (!party_id || typeof party_id !== 'string') {
    const e = new Error('Missing party_id');
    e.statusCode = 400;
    throw e;
  }
  const validSources = ['customer', 'pickup_location', 'delivery_location', 'return_location', 'other_org', 'default'];
  if (source != null && !validSources.includes(source)) {
    const e = new Error(`Invalid source — must be one of ${validSources.join(', ')}`);
    e.statusCode = 400;
    throw e;
  }

  // Cross-tenant check: party must exist in our tenant
  const refTable = party_type === 'group' ? 'organization_groups' : 'organization_contacts';
  const { data: ref } = await svc
    .from(refTable)
    .select('id')
    .eq('id', party_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (!ref) {
    const e = new Error(`Referenced ${party_type} not found in this tenant`);
    e.statusCode = 400;
    throw e;
  }

  const insertRec = {
    tenant_id: ctx.tenantId,
    load_id: loadId,
    party_type,
    party_id,
    source: source || null,
    source_organization_id: source_organization_id || null,
    created_by: ctx.userId,
    updated_by: ctx.userId,
  };

  const { data: row, error } = await svc
    .from('load_notify_parties')
    .insert(insertRec)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      const e = new Error('Notify party already attached to this load');
      e.statusCode = 409;
      throw e;
    }
    const e = new Error(error.message || 'Insert failed');
    e.statusCode = 500;
    throw e;
  }

  // Audit log — use injected logger if provided (for testability)
  if (logger) {
    await logger(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.notify_party_added',
      entityType: 'load',
      entityId: loadId,
      newValues: { party_type, party_id, source, source_organization_id },
      ipAddress,
      actorType: 'human',
    });
  }

  return { row };
}
