export async function logTenantAction(supabase, {
  tenantId,
  userId,
  action,
  entityType,
  entityId = null,
  oldValues = null,
  newValues = null,
  ipAddress = null,
  actorType = 'human',    // Stream B.1d — 'human' | 'system' | 'agent'
  agentMetadata = null,   // Stream B.1d — JSONB for future Stream C intent/outcome/token/cost
}) {
  const { error } = await supabase.from('tenant_audit_log').insert({
    tenant_id: tenantId,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues,
    new_values: newValues,
    ip_address: ipAddress,
    actor_type: actorType,
    agent_metadata: agentMetadata,
  });

  if (error) {
    console.error('Failed to log tenant action:', error.message);
  }
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}
