export async function logAdminAction(supabase, {
  employeeId,
  action,
  targetTenantId = null,
  targetUserId = null,
  details = null,
  ipAddress = null,
}) {
  const { error } = await supabase.from('admin_audit_log').insert({
    dd_employee_id: employeeId,
    action,
    target_tenant_id: targetTenantId,
    target_user_id: targetUserId,
    details,
    ip_address: ipAddress,
  });

  if (error) {
    console.error('Failed to log admin action:', error.message);
  }
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}
