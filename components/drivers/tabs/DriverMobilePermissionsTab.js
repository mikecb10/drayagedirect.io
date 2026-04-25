import Checkbox from '../../ui/Checkbox';

const DISPATCH_PERMISSIONS = [
  { key: 'allow_reject_loads', label: 'Allow driver to reject loads' },
  { key: 'never_require_tir_in', label: 'Never require TIR IN for this driver' },
  { key: 'never_require_tir_out', label: 'Never require TIR OUT for this driver' },
  { key: 'never_require_pod', label: 'Never require POD for this driver' },
  { key: 'never_require_pod_signature', label: 'Never require POD signature' },
  { key: 'never_require_chassis', label: 'Never require chassis # to be entered' },
  { key: 'never_require_trailer', label: 'Never require trailer number to be entered' },
  { key: 'never_require_container', label: 'Never require container # to be entered' },
  { key: 'allow_edit_container', label: 'Allow driver to edit container number' },
  { key: 'require_bol_export', label: 'Require BOL upload for Export Loads' },
  { key: 'allow_complete_without_return', label: 'Allow driver to complete load without return location' },
  { key: 'require_chassis_from_list', label: 'Require driver to select chassis from company list' },
  { key: 'deny_update_seal', label: 'Deny driver to update seal number' },
  { key: 'require_seal_import', label: 'Require seal number for import loads' },
  { key: 'require_tare_weight', label: 'Require driver to update Tare Weight' },
];

const OTHER_PERMISSIONS = [
  { key: 'allow_chat', label: 'Allow chat for driver' },
  { key: 'allow_group_chat', label: 'Allow group chat for driver' },
  { key: 'never_show_settlement', label: 'Never show driver access to settlement tab' },
  { key: 'never_show_pay', label: 'Never show driver pay to this driver' },
  { key: 'never_show_commodity', label: 'Never show commodity on mobile app' },
  { key: 'require_clock_in_to_start', label: 'Require driver clocked in to accept/start load' },
  { key: 'require_geofence_clock_in', label: "Require driver to clock into geofenced location first" },
  { key: 'allow_view_documents', label: 'Allow driver to view document types in General Settings' },
  { key: 'allow_add_weight_pieces', label: 'Allow to add weight and pieces for commodities' },
];

const PROFILE_PERMISSIONS = [
  { key: 'allow_update_truck', label: 'Allow driver to update truck information' },
  { key: 'allow_update_chassis', label: 'Allow driver to update chassis information' },
  { key: 'allow_update_trailer', label: 'Allow driver to update trailer information' },
  { key: 'allow_update_docs', label: 'Allow driver to update docs & expirations (TWIC, medical, CDL, sealink)' },
];

function PermissionGroup({ title, permissions, values, onChange }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">{title}</h4>
      <div className="space-y-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
        {permissions.map((p) => (
          <Checkbox
            key={p.key}
            checked={!!values[p.key]}
            onChange={(v) => onChange({ ...values, [p.key]: v })}
            label={p.label}
          />
        ))}
      </div>
    </div>
  );
}

export default function DriverMobilePermissionsTab({ form, update }) {
  const perms = form.mobile_permissions || {};

  function setPerms(newPerms) {
    update('mobile_permissions', newPerms);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 dark:text-slate-400">
        Control what this driver can do and see in the mobile app. Each carrier has different
        policies about what drivers can self-service.
      </p>
      <PermissionGroup
        title="Dispatch"
        permissions={DISPATCH_PERMISSIONS}
        values={perms}
        onChange={setPerms}
      />
      <PermissionGroup
        title="Other"
        permissions={OTHER_PERMISSIONS}
        values={perms}
        onChange={setPerms}
      />
      <PermissionGroup
        title="Profile"
        permissions={PROFILE_PERMISSIONS}
        values={perms}
        onChange={setPerms}
      />

      {/* Location tracking — top-level driver column (NOT nested in mobile_permissions JSONB).
          Per migration 102, drivers.location_tracking_enabled is a top-level boolean read by
          requireDriver middleware + 3-gate helper. Keep this toggle outside the PermissionGroup
          iterators so it routes through update('location_tracking_enabled', value) directly. */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Location tracking</h4>
        <div className="space-y-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
          <Checkbox
            checked={form?.location_tracking_enabled !== false}
            onChange={(v) => update('location_tracking_enabled', v)}
            label="Track driver location during moves"
          />
          <p className="text-xs text-gray-500 dark:text-slate-400 ml-6">
            When enabled and the tenant feature is on, the driver mobile app reports GPS pings during active moves.
            Driver consent on first login is still required.
          </p>
        </div>
      </div>

      {(form?.tracking_consented_at || form?.tracking_revoked_at) && (
        <div className="text-xs text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
          {form.tracking_consented_at && (
            <div>Last consented: {new Date(form.tracking_consented_at).toLocaleString()} (v{form.tracking_consent_version || '?'})</div>
          )}
          {form.tracking_revoked_at && (
            <div className="text-amber-700 dark:text-amber-400">
              Revoked: {new Date(form.tracking_revoked_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
