import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Trash2,
  Umbrella as UmbrellaIcon,
  Shield,
  Zap,
  Gauge,
  Filter,
  Plus,
  X,
  Users,
  Mail,
  Eye,
  MoreVertical,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import Alert from '../../../../components/ui/Alert';

/**
 * Settings → Communications → Umbrellas → Editor
 *
 * Handles both "edit existing" (id = UUID) and "create new" (id = 'new').
 *
 * Layout (single column, full width):
 *   ┌──────────────────────────────────────────┐
 *   │  Details card  (name + description)      │
 *   ├──────────────────────────────────────────┤
 *   │  Scope Filters card (19 fields)          │
 *   │  + specificity meter (live)              │
 *   ├──────────────────────────────────────────┤
 *   │  Behavior card (always_run toggle)       │
 *   ├──────────────────────────────────────────┤
 *   │  Email Groups card (dynamic)             │
 *   │    Group 1: [recipients + templates]     │
 *   │    Group 2: ...                          │
 *   │    + Add Group                           │
 *   ├──────────────────────────────────────────┤
 *   │  Save / Reset / Delete                   │
 *   └──────────────────────────────────────────┘
 *
 * Groups are edited in-place with a separate save-per-group pattern
 * (not batched into the umbrella save) so the UX stays responsive for
 * the long-lived editor session.
 */

const BLANK_UMBRELLA = {
  id: null,
  name: '',
  description: '',
  is_active: true,
  is_default: false,
  always_run: false,
  specificity_score: 0,
  // 27 filter fields after migration 058 — nulls + empty array by default
  load_types: [],
  customer_id: null,
  pickup_location_id: null,
  delivery_location_id: null,
  return_location_id: null,
  container_type: null,
  container_size: null,
  ssl: null,
  csr: null,
  route_id: null,
  chassis_type: null,
  chassis_size: null,
  chassis_owner: null,
  // 14 boolean flags — null = don't care, true = required
  hazmat: null,
  overweight: null,
  liquor: null,
  hot: null,
  genset: null,
  oog: null,
  overheight: null,
  scale: null,
  ev: null,
  street_turn: null,
  bonded: null,
  double: null,
  tanker: null,
  bill_only: null,
  groups: [],
};

// Load types are now multi-select via checkboxes. No "Any" entry —
// an empty array IS "any".
const LOAD_TYPE_OPTIONS = [
  { value: 'import', label: 'Import' },
  { value: 'export', label: 'Export' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'one_way', label: 'One-Way' },
];

// Full 14-flag catalog shown as a checkbox grid. The UI binds each box
// to a boolean column on email_umbrellas — checked = require true,
// unchecked = NULL (don't care). We never set flags to FALSE via the
// UI since "only non-hazmat" is rare enough that it can be deferred.
const LOAD_FLAGS = [
  { key: 'hazmat', label: 'Hazmat' },
  { key: 'overweight', label: 'Overweight' },
  { key: 'overheight', label: 'Overheight' },
  { key: 'liquor', label: 'Liquor' },
  { key: 'hot', label: 'Hot' },
  { key: 'genset', label: 'Genset' },
  { key: 'oog', label: 'OOG' },
  { key: 'scale', label: 'Scale' },
  { key: 'ev', label: 'EV' },
  { key: 'street_turn', label: 'Street Turn' },
  { key: 'bonded', label: 'Bonded' },
  { key: 'double', label: 'Double' },
  { key: 'tanker', label: 'Tanker' },
  { key: 'bill_only', label: 'Bill Only' },
];

const FLAG_KEYS = LOAD_FLAGS.map((f) => f.key);

const FILTER_FIELDS_FOR_SCORE = [
  'load_types',
  'customer_id',
  'pickup_location_id',
  'delivery_location_id',
  'return_location_id',
  'container_type',
  'container_size',
  'ssl',
  'csr',
  'route_id',
  'chassis_type',
  'chassis_size',
  'chassis_owner',
  ...FLAG_KEYS,
];

// Helper: compose a location picker label from an organization row so
// users can tell "Jolly's Warehouse 1" in Richmond from "Jolly's
// Warehouse 1" in Dallas at a glance. Falls back to just the name when
// the org has no city/state populated.
function locationLabel(org) {
  if (!org) return '';
  const loc = [org.city, org.state].filter(Boolean).join(', ');
  return loc ? `${org.name} — ${loc}` : org.name;
}

export default function UmbrellaEditor() {
  const router = useRouter();
  const { id } = router.query;
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  const [umbrella, setUmbrella] = useState(BLANK_UMBRELLA);
  const [original, setOriginal] = useState(BLANK_UMBRELLA);

  // Per-group save state for the auto-save indicator on each GroupCard.
  // Map of { [groupId]: 'saving' | 'saved' | 'error' }. 'saved' auto-clears
  // after ~1.8s so the green checkmark flashes briefly then fades.
  const [groupSaveState, setGroupSaveState] = useState({});

  function flashGroupSaved(groupId) {
    setGroupSaveState((s) => ({ ...s, [groupId]: 'saved' }));
    setTimeout(() => {
      setGroupSaveState((s) => {
        if (s[groupId] !== 'saved') return s;
        const next = { ...s };
        delete next[groupId];
        return next;
      });
    }, 1800);
  }

  function flashGroupError(groupId) {
    setGroupSaveState((s) => ({ ...s, [groupId]: 'error' }));
    setTimeout(() => {
      setGroupSaveState((s) => {
        if (s[groupId] !== 'error') return s;
        const next = { ...s };
        delete next[groupId];
        return next;
      });
    }, 3000);
  }

  // Reference data for scope pickers
  const [allOrgs, setAllOrgs] = useState([]);
  const [containerTypes, setContainerTypes] = useState([]);
  const [containerSizes, setContainerSizes] = useState([]);
  const [chassisTypes, setChassisTypes] = useState([]);
  const [chassisSizes, setChassisSizes] = useState([]);
  const [containerOwners, setContainerOwners] = useState([]);
  const [chassisOwners, setChassisOwners] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [allTemplates, setAllTemplates] = useState([]);

  // Load reference data once. The reference data handler in
  // lib/reference-data-handler.js returns { items } for every
  // container_types / container_sizes / chassis_types / chassis_sizes
  // endpoint — that was the bug that made the dropdowns look empty.
  // chassis_owners is a NEW tenant-created directory table (migration
  // 059) — NOT the same as container_owners (SSLs).
  useEffect(() => {
    (async () => {
      const fetches = await Promise.all([
        fetch('/api/tenant/organizations').then((r) => (r.ok ? r.json() : { organizations: [] })),
        fetch('/api/tenant/container-types?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
        fetch('/api/tenant/container-sizes?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
        fetch('/api/tenant/chassis-types?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
        fetch('/api/tenant/chassis-sizes?enabled=true').then((r) => (r.ok ? r.json() : { items: [] })),
        fetch('/api/tenant/container-owners').then((r) => (r.ok ? r.json() : { container_owners: [] })),
        fetch('/api/tenant/chassis-owners?enabled=true').then((r) => (r.ok ? r.json() : { chassis_owners: [] })),
        fetch('/api/tenant/users').then((r) => (r.ok ? r.json() : { users: [] })),
        fetch('/api/tenant/emails/templates?active=true').then((r) => (r.ok ? r.json() : { templates: [] })),
      ]);
      setAllOrgs(fetches[0].organizations || fetches[0].customers || []);
      setContainerTypes(fetches[1].items || []);
      setContainerSizes(fetches[2].items || []);
      setChassisTypes(fetches[3].items || []);
      setChassisSizes(fetches[4].items || []);
      setContainerOwners(
        fetches[5].container_owners || fetches[5].items || fetches[5].data || []
      );
      setChassisOwners(fetches[6].chassis_owners || []);
      setTenantUsers(fetches[7].users || fetches[7].items || []);
      setAllTemplates(fetches[8].templates || []);
    })();
  }, []);

  // Split orgs by type for the Customer vs location pickers. The Customer
  // picker only shows orgs whose customer_types array includes 'customer';
  // location pickers show every org (since a location can be any org
  // — terminal, warehouse, yard, final_destination, or even a customer
  // that receives direct deliveries).
  const customerOrgs = useMemo(
    () =>
      (allOrgs || []).filter(
        (o) => Array.isArray(o.customer_types) && o.customer_types.includes('customer')
      ),
    [allOrgs]
  );
  const locationOrgs = allOrgs;

  // Load the umbrella
  useEffect(() => {
    if (!router.isReady) return;
    if (isNew) {
      setLoading(false);
      setUmbrella(BLANK_UMBRELLA);
      setOriginal(BLANK_UMBRELLA);
      return;
    }
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/tenant/emails/umbrellas/${id}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || 'Failed to load umbrella');
        }
        const data = await res.json();
        // Normalize null-vs-undefined across filter fields so our comparisons work
        const normalized = { ...BLANK_UMBRELLA, ...data.umbrella };
        setUmbrella(normalized);
        setOriginal(normalized);
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, id, isNew]);

  function handleChange(field, value) {
    setUmbrella((u) => ({ ...u, [field]: value }));
  }

  function handleReset() {
    setUmbrella(original);
    setSaveError(null);
    setSaveSuccess(null);
  }

  // Live-computed specificity score — mirrors the DB trigger logic so
  // users see the score update as they populate filters, without waiting
  // for a round-trip. load_types counts as 1 if the array is non-empty
  // (regardless of how many entries); flags count 1 each when true.
  const liveSpecificityScore = useMemo(() => {
    let score = 0;
    for (const f of FILTER_FIELDS_FOR_SCORE) {
      const v = umbrella[f];
      if (f === 'load_types') {
        if (Array.isArray(v) && v.length > 0) score += 1;
      } else if (v !== null && v !== undefined && v !== '') {
        score += 1;
      }
    }
    return score;
  }, [umbrella]);

  async function handleSave(e) {
    e?.preventDefault?.();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const payload = {
        name: umbrella.name,
        description: umbrella.description,
        is_active: umbrella.is_active,
        always_run: umbrella.always_run,
      };
      for (const f of FILTER_FIELDS_FOR_SCORE) {
        const v = umbrella[f];
        if (f === 'load_types') {
          payload[f] = Array.isArray(v) ? v : [];
        } else if (v === '') {
          payload[f] = null;
        } else {
          payload[f] = v;
        }
      }

      const url = isNew
        ? '/api/tenant/emails/umbrellas'
        : `/api/tenant/emails/umbrellas/${id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Save failed');
      }
      const data = await res.json();
      if (isNew) {
        router.replace(`/settings/communications/umbrellas/${data.umbrella.id}`);
      } else {
        const refreshed = { ...BLANK_UMBRELLA, ...data.umbrella };
        setUmbrella(refreshed);
        setOriginal(refreshed);
        setSaveSuccess('Umbrella saved.');
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (umbrella.is_default) return;
    if (!confirm(`Delete "${umbrella.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/tenant/emails/umbrellas/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Delete failed');
      }
      router.push('/settings/communications/umbrellas');
    } catch (e) {
      setSaveError(e.message);
      setDeleting(false);
    }
  }

  // ── Groups handlers (operate directly against the API so each group
  //    action is atomic rather than bundled into the umbrella save) ──

  async function reloadUmbrella() {
    if (isNew || !id) return;
    const res = await fetch(`/api/tenant/emails/umbrellas/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const normalized = { ...BLANK_UMBRELLA, ...data.umbrella };
    setUmbrella(normalized);
    setOriginal((prev) => ({ ...prev, groups: normalized.groups }));
  }

  async function handleAddGroup() {
    if (isNew) {
      setSaveError('Save the umbrella first, then you can add email groups.');
      return;
    }
    const name = prompt('Group name (e.g. "Customer AP", "Warehouse Receiving")');
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(
        `/api/tenant/emails/umbrellas/${id}/groups`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to create group');
      }
      await reloadUmbrella();
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function handleDeleteGroup(group) {
    if (!confirm(`Delete group "${group.name}"? This also removes all attached templates.`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/tenant/emails/umbrellas/${id}/groups/${group.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete group');
      }
      await reloadUmbrella();
    } catch (e) {
      setSaveError(e.message);
    }
  }

  async function handleUpdateGroup(group, updates) {
    setGroupSaveState((s) => ({ ...s, [group.id]: 'saving' }));
    try {
      const res = await fetch(
        `/api/tenant/emails/umbrellas/${id}/groups/${group.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update group');
      }
      await reloadUmbrella();
      flashGroupSaved(group.id);
    } catch (e) {
      setSaveError(e.message);
      flashGroupError(group.id);
    }
  }

  async function handleAttachTemplate(group, templateId) {
    setGroupSaveState((s) => ({ ...s, [group.id]: 'saving' }));
    try {
      const res = await fetch(
        `/api/tenant/emails/umbrellas/${id}/groups/${group.id}/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: templateId }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to attach template');
      }
      await reloadUmbrella();
      flashGroupSaved(group.id);
    } catch (e) {
      setSaveError(e.message);
      flashGroupError(group.id);
    }
  }

  async function handleDetachTemplate(group, attachmentId) {
    setGroupSaveState((s) => ({ ...s, [group.id]: 'saving' }));
    try {
      const res = await fetch(
        `/api/tenant/emails/umbrellas/${id}/groups/${group.id}/templates?attachment_id=${attachmentId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to detach template');
      }
      await reloadUmbrella();
      flashGroupSaved(group.id);
    } catch (e) {
      setSaveError(e.message);
      flashGroupError(group.id);
    }
  }

  // Is the umbrella metadata (not groups) dirty? Groups save separately.
  const isDirty = useMemo(() => {
    const keys = [
      'name',
      'description',
      'is_active',
      'always_run',
      ...FILTER_FIELDS_FOR_SCORE,
    ];
    for (const k of keys) {
      if ((umbrella[k] ?? null) !== (original[k] ?? null)) return true;
    }
    return false;
  }, [umbrella, original]);

  if (loadError) {
    return (
      <SettingsLayout title="Umbrella">
        <div className="max-w-4xl">
          <BackLink />
          <Alert type="error" message={loadError} />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout title={isNew ? 'New Umbrella' : umbrella.name || 'Umbrella'}>
      <div className="max-w-[1400px]">
        <BackLink />

        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            {umbrella.is_default ? (
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <UmbrellaIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                {isNew ? 'New Umbrella' : umbrella.name || 'Untitled'}
              </h1>
              {umbrella.is_default && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-2 py-0.5 rounded">
                  Default Umbrella
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Define which loads this umbrella matches on the left, then add email groups on the right.
            </p>
          </div>
        </div>

        {saveError && <Alert type="error" message={saveError} className="mb-4" />}
        {saveSuccess && <Alert type="success" message={saveSuccess} className="mb-4" />}

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave}>
            {/* Two-column layout: scope filters left, email groups right.
                Tailwind arbitrary values use underscores for spaces, so
                `320px_1fr` compiles to `grid-template-columns: 320px 1fr`. */}
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
              {/* ═════════════════ LEFT COLUMN ═════════════════ */}
              <aside className="space-y-4 lg:sticky lg:top-4">
                {/* Details */}
                <SidebarSection title="Details">
                  <Input
                    label="Name *"
                    value={umbrella.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder='e.g. "ACME Imports → Ontario"'
                    required
                  />
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                      Description
                    </label>
                    <textarea
                      value={umbrella.description || ''}
                      onChange={(e) => handleChange('description', e.target.value)}
                      placeholder="Internal notes"
                      rows={2}
                      className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </SidebarSection>

                {/* Scope Filters */}
                <SidebarSection
                  title="Scope Filters"
                  description="Only populated fields affect matching. Leave blank for catch-all."
                  headerRight={<SpecificityBadge score={liveSpecificityScore} />}
                >
                  {/* Load types — multi-select checkboxes (a load can match
                      more than one of these, so we let the umbrella apply
                      to Import AND Export at the same time) */}
                  <div className="mb-3">
                    <div className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">
                      Load Type
                    </div>
                    <div className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 grid grid-cols-2 gap-1.5">
                      {LOAD_TYPE_OPTIONS.map((opt) => {
                        const current = umbrella.load_types || [];
                        const checked = current.includes(opt.value);
                        return (
                          <label
                            key={opt.value}
                            className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer hover:text-gray-900 dark:hover:text-slate-100 select-none px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...current, opt.value]
                                  : current.filter((v) => v !== opt.value);
                                handleChange('load_types', next);
                              }}
                              className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                            />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                    {(!umbrella.load_types || umbrella.load_types.length === 0) && (
                      <div className="mt-1 text-[10px] text-gray-400 dark:text-slate-500 italic">
                        None selected — matches any load type
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Select
                      label="Customer"
                      placeholder="— Any —"
                      value={umbrella.customer_id || ''}
                      onChange={(e) => handleChange('customer_id', e.target.value || null)}
                      options={customerOrgs.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                    />
                    <Select
                      label="Pickup Location"
                      placeholder="— Any —"
                      value={umbrella.pickup_location_id || ''}
                      onChange={(e) =>
                        handleChange('pickup_location_id', e.target.value || null)
                      }
                      options={locationOrgs.map((c) => ({
                        value: c.id,
                        label: locationLabel(c),
                      }))}
                    />
                    <Select
                      label="Delivery Location"
                      placeholder="— Any —"
                      value={umbrella.delivery_location_id || ''}
                      onChange={(e) =>
                        handleChange('delivery_location_id', e.target.value || null)
                      }
                      options={locationOrgs.map((c) => ({
                        value: c.id,
                        label: locationLabel(c),
                      }))}
                    />
                    <Select
                      label="Return Location"
                      placeholder="— Any —"
                      value={umbrella.return_location_id || ''}
                      onChange={(e) =>
                        handleChange('return_location_id', e.target.value || null)
                      }
                      options={locationOrgs.map((c) => ({
                        value: c.id,
                        label: locationLabel(c),
                      }))}
                    />
                    <Select
                      label="Container Type"
                      placeholder="— Any —"
                      value={umbrella.container_type || ''}
                      onChange={(e) => handleChange('container_type', e.target.value || null)}
                      options={containerTypes.map((t) => ({
                        value: t.code || t.label || t.name,
                        label: t.label || t.name || t.code,
                      }))}
                    />
                    <Select
                      label="Container Size"
                      placeholder="— Any —"
                      value={umbrella.container_size || ''}
                      onChange={(e) => handleChange('container_size', e.target.value || null)}
                      options={containerSizes.map((s) => ({
                        value: s.code || s.label || s.name,
                        label: s.label || s.name || s.code,
                      }))}
                    />
                    <Select
                      label="SSL / Container Owner"
                      placeholder="— Any —"
                      value={umbrella.ssl || ''}
                      onChange={(e) => handleChange('ssl', e.target.value || null)}
                      options={containerOwners.map((o) => ({
                        value: o.scac_code || o.scac || o.name,
                        label: `${o.name}${o.scac_code || o.scac ? ` (${o.scac_code || o.scac})` : ''}`,
                      }))}
                    />
                    <Select
                      label="CSR"
                      placeholder="— Any —"
                      value={umbrella.csr || ''}
                      onChange={(e) => handleChange('csr', e.target.value || null)}
                      options={tenantUsers.map((u) => {
                        const name =
                          u.first_name || u.last_name
                            ? [u.first_name, u.last_name].filter(Boolean).join(' ')
                            : u.name || u.email;
                        return { value: name, label: name };
                      })}
                    />
                    <Select
                      label="Chassis Type"
                      placeholder="— Any —"
                      value={umbrella.chassis_type || ''}
                      onChange={(e) => handleChange('chassis_type', e.target.value || null)}
                      options={chassisTypes.map((t) => ({
                        value: t.code || t.label || t.name,
                        label: t.label || t.name || t.code,
                      }))}
                    />
                    <Select
                      label="Chassis Size"
                      placeholder="— Any —"
                      value={umbrella.chassis_size || ''}
                      onChange={(e) => handleChange('chassis_size', e.target.value || null)}
                      options={chassisSizes.map((s) => ({
                        value: s.code || s.label || s.name,
                        label: s.label || s.name || s.code,
                      }))}
                    />
                    <Select
                      label="Chassis Owner"
                      placeholder="— Any —"
                      value={umbrella.chassis_owner || ''}
                      onChange={(e) => handleChange('chassis_owner', e.target.value || null)}
                      options={chassisOwners.map((o) => ({
                        value: o.code || o.name,
                        label: `${o.name}${o.code ? ` (${o.code})` : ''}${o.is_own_fleet ? ' — Own Fleet' : ''}`,
                      }))}
                    />
                  </div>

                  {/* Load flags as checkboxes — clean, scannable, no more
                      tri-state Select dropdowns cluttering the sidebar */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-800">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                      Load Flags
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-slate-500 mb-3 leading-snug">
                      Check a flag to require it. Unchecked = don&apos;t care (matches both).
                    </div>
                    <div className="rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 grid grid-cols-2 gap-1.5">
                      {LOAD_FLAGS.map((f) => (
                        <label
                          key={f.key}
                          className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer hover:text-gray-900 dark:hover:text-slate-100 select-none px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-800/60"
                        >
                          <input
                            type="checkbox"
                            checked={umbrella[f.key] === true}
                            onChange={(e) =>
                              handleChange(f.key, e.target.checked ? true : null)
                            }
                            className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </SidebarSection>

                {/* Behavior */}
                <SidebarSection title="Behavior">
                  <ToggleRow
                    label="Always run"
                    description="Fires even when a more specific umbrella also matches."
                    checked={!!umbrella.always_run}
                    onChange={(v) => handleChange('always_run', v)}
                  />
                  <div className="mt-2">
                    <ToggleRow
                      label="Active"
                      description="Inactive umbrellas are skipped entirely."
                      checked={!!umbrella.is_active}
                      onChange={(v) => handleChange('is_active', v)}
                    />
                  </div>
                </SidebarSection>
              </aside>

              {/* ═════════════════ RIGHT COLUMN ═════════════════ */}
              <div className="min-w-0 space-y-4">
                {isNew ? (
                  <div className="rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-10 text-center">
                    <Users className="w-10 h-10 mx-auto text-blue-400 dark:text-blue-500 mb-3" />
                    <div className="text-base font-semibold text-blue-900 dark:text-blue-200">
                      Save the umbrella first to add Email Groups
                    </div>
                    <div className="text-sm text-blue-700/80 dark:text-blue-300/80 mt-1 max-w-md mx-auto">
                      Give your umbrella a name and scope filters on the left, then click{' '}
                      <strong>Create Umbrella</strong> to unlock the Email Groups editor here.
                    </div>
                  </div>
                ) : (
                  <Section
                    title="Email Groups"
                    description="Each group has its own To/Cc/Bcc recipients and attached templates. When a trigger fires and this umbrella matches, every group sends its attached templates to its recipient list. Groups auto-save as you edit them — watch for the ✓ Saved indicator."
                    headerRight={
                      <button
                        type="button"
                        onClick={handleAddGroup}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add Group
                      </button>
                    }
                  >
                    {!umbrella.groups || umbrella.groups.length === 0 ? (
                      <div className="py-12 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
                        <Users className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-2" />
                        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                          No email groups yet
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                          Click <strong>Add Group</strong> to create the first recipient list.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {umbrella.groups.map((g, idx) => (
                          <GroupCard
                            key={g.id}
                            group={g}
                            index={idx}
                            allTemplates={allTemplates}
                            saveState={groupSaveState[g.id]}
                            onUpdate={(updates) => handleUpdateGroup(g, updates)}
                            onDelete={() => handleDeleteGroup(g)}
                            onAttachTemplate={(templateId) =>
                              handleAttachTemplate(g, templateId)
                            }
                            onDetachTemplate={(attachmentId) =>
                              handleDetachTemplate(g, attachmentId)
                            }
                          />
                        ))}
                      </div>
                    )}
                  </Section>
                )}
              </div>
            </div>

            {/* Save bar — full-width sticky at the bottom */}
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 mt-5 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 dark:bg-slate-950/95 border-t border-gray-200 dark:border-slate-800 backdrop-blur flex items-center justify-between gap-3 z-10">
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {isNew ? (
                  'Unsaved — click Save to create'
                ) : isDirty ? (
                  'Unsaved scope/details changes'
                ) : (
                  <>
                    Scope &amp; details saved.{' '}
                    <span className="text-gray-400 dark:text-slate-500">
                      Email Groups auto-save on every edit.
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isNew && !umbrella.is_default && (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={handleDelete}
                    disabled={saving || deleting}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleReset}
                  disabled={!isDirty || saving}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Reset
                </Button>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!isNew && !isDirty}
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {isNew ? 'Create Umbrella' : 'Save'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </SettingsLayout>
  );
}

// ──────────────────────────────────────────────────────────────
// GroupCard — nested within the umbrella editor
// ──────────────────────────────────────────────────────────────
function GroupCard({
  group,
  index,
  allTemplates,
  saveState,
  onUpdate,
  onDelete,
  onAttachTemplate,
  onDetachTemplate,
}) {
  const [localName, setLocalName] = useState(group.name);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setLocalName(group.name);
  }, [group.name]);

  function addRecipient(kind, value) {
    if (!value || !value.trim()) return;
    const entry = { type: 'email', value: value.trim() };
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    // Avoid duplicates
    if (current.some((r) => r.type === 'email' && r.value === entry.value)) return;
    onUpdate({ [key]: [...current, entry] });
  }

  function removeRecipient(kind, index) {
    const key = `${kind}_recipients`;
    const current = Array.isArray(group[key]) ? group[key] : [];
    const next = current.filter((_, i) => i !== index);
    onUpdate({ [key]: next });
  }

  function saveNameIfChanged() {
    if (localName.trim() && localName.trim() !== group.name) {
      onUpdate({ name: localName.trim() });
    } else {
      setLocalName(group.name);
    }
  }

  const attachedIds = new Set((group.templates || []).map((t) => t.id));
  const availableTemplates = allTemplates.filter((t) => !attachedIds.has(t.id));

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-200 dark:border-slate-800 bg-gradient-to-r from-blue-50/60 to-transparent dark:from-blue-950/30 dark:to-transparent">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm font-bold shadow-sm">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-0.5">
            Email Group
          </div>
          <input
            type="text"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={saveNameIfChanged}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
              }
            }}
            placeholder="Click to name this group…"
            className="w-full text-base font-semibold bg-transparent border-none outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-0"
          />
        </div>
        {/* Auto-save indicator */}
        <GroupSaveIndicator state={saveState} />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 cursor-pointer select-none px-2 py-1 rounded hover:bg-white/60 dark:hover:bg-slate-800/60">
          <input
            type="checkbox"
            checked={!!group.is_active}
            onChange={(e) => onUpdate({ is_active: e.target.checked })}
            className="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
          Active
        </label>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
          title="Delete group"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Recipients — clearly delineated input fields */}
      <div className="px-5 pt-5 pb-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          Recipients
        </div>
        <div className="space-y-3">
          <RecipientRow
            label="To"
            accentColor="blue"
            required
            recipients={group.to_recipients || []}
            input={toInput}
            onInputChange={setToInput}
            onAdd={() => {
              addRecipient('to', toInput);
              setToInput('');
            }}
            onRemove={(idx) => removeRecipient('to', idx)}
          />
          <RecipientRow
            label="Cc"
            accentColor="gray"
            recipients={group.cc_recipients || []}
            input={ccInput}
            onInputChange={setCcInput}
            onAdd={() => {
              addRecipient('cc', ccInput);
              setCcInput('');
            }}
            onRemove={(idx) => removeRecipient('cc', idx)}
          />
          <RecipientRow
            label="Bcc"
            accentColor="gray"
            recipients={group.bcc_recipients || []}
            input={bccInput}
            onInputChange={setBccInput}
            onAdd={() => {
              addRecipient('bcc', bccInput);
              setBccInput('');
            }}
            onRemove={(idx) => removeRecipient('bcc', idx)}
          />
        </div>
        <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
          Press <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 font-mono">Enter</kbd> or <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 font-mono">,</kbd> to add each recipient.
        </div>
      </div>

      {/* Templates */}
      <div className="px-5 py-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
            <Mail className="w-3 h-3" />
            Templates this group sends ({(group.templates || []).length})
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Attach Template
          </button>
        </div>

        {/* Full-screen modal picker — renders outside the cramped dropdown
            pattern so the user sees many templates at once */}
        {pickerOpen && (
          <AttachTemplateModal
            allTemplates={allTemplates}
            availableTemplates={availableTemplates}
            onClose={() => setPickerOpen(false)}
            onSelect={(templateId) => {
              onAttachTemplate(templateId);
              setPickerOpen(false);
            }}
          />
        )}
        {(group.templates || []).length === 0 ? (
          <div className="py-6 text-center rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50">
            <Mail className="w-6 h-6 mx-auto text-gray-300 dark:text-slate-600 mb-1.5" />
            <div className="text-xs text-gray-500 dark:text-slate-400">
              No templates attached to this group yet
            </div>
            <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
              Click <strong>Attach Template</strong> above to pick one
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {(group.templates || []).map((t) => (
              <div
                key={t.attachment_id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                {t.is_system ? (
                  <Shield className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                ) : (
                  <Mail className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 dark:text-slate-100 truncate">
                    {t.name}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-slate-400 truncate">
                    {t.subject}
                  </div>
                </div>
                <Link
                  href={`/settings/communications/templates/${t.id}`}
                  className="p-1 rounded text-gray-400 hover:text-blue-600 dark:text-slate-500 dark:hover:text-blue-400"
                  title="Open template editor"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => onDetachTemplate(t.attachment_id)}
                  className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40"
                  title="Detach template"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Tiny internal components
// ──────────────────────────────────────────────────────────────
function Section({ title, description, headerRight, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1 gap-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
          {title}
        </h2>
        {headerRight}
      </div>
      {description && (
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{description}</p>
      )}
      {children}
    </section>
  );
}

// Compact card for the left sidebar — smaller padding + tighter spacing
// so many stacked sections fit in a narrow column without feeling bloated.
function SidebarSection({ title, description, headerRight, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          {title}
        </h3>
        {headerRight}
      </div>
      {description && (
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3 leading-snug">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function BackLink() {
  return (
    <Link
      href="/settings/communications/umbrellas"
      className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4"
    >
      <ArrowLeft className="w-4 h-4" />
      Back to umbrellas
    </Link>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 p-3 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{label}</div>
        {description && (
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={!!checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </label>
  );
}

function SpecificityBadge({ score }) {
  const max = 19;
  const pct = Math.min(100, (score / max) * 100);
  const tone =
    score === 0
      ? 'text-gray-600 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700'
      : score <= 3
      ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60'
      : score <= 8
      ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/60'
      : 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900/60';
  const color =
    score === 0
      ? 'bg-gray-300 dark:bg-slate-700'
      : score <= 3
      ? 'bg-blue-500'
      : score <= 8
      ? 'bg-indigo-500'
      : 'bg-purple-500';
  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border ${tone}`}
      title="Specificity score = number of populated filter fields. Higher scores suppress lower ones unless always_run is set."
    >
      <Gauge className="w-3.5 h-3.5" />
      <span className="text-[11px] font-semibold">Specificity</span>
      <span className="w-16 h-1.5 rounded-full bg-white/60 dark:bg-black/20 overflow-hidden">
        <span className={`h-full block ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs font-bold">{score}</span>
    </div>
  );
}

function RecipientRow({
  label,
  accentColor = 'gray',
  required = false,
  recipients,
  input,
  onInputChange,
  onAdd,
  onRemove,
}) {
  const labelClass =
    accentColor === 'blue'
      ? 'text-blue-700 dark:text-blue-300'
      : 'text-gray-600 dark:text-slate-300';
  return (
    <div className="flex items-start gap-3">
      {/* Label column — fixed width so To/Cc/Bcc align cleanly */}
      <div className="shrink-0 pt-2 w-10">
        <div className={`text-xs font-semibold ${labelClass}`}>
          {label}
          {required && <span className="text-rose-500 ml-0.5">*</span>}
        </div>
      </div>

      {/* Input field container — proper bordered chip input */}
      <div className="flex-1 min-w-0">
        <label className="block cursor-text">
          <div
            className="flex flex-wrap gap-1.5 items-center min-h-[38px] rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40 transition-colors"
          >
            {recipients.map((r, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300"
              >
                {r.value}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(idx);
                  }}
                  className="hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  aria-label={`Remove ${r.value}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  onAdd();
                }
              }}
              onBlur={onAdd}
              placeholder={
                recipients.length === 0
                  ? 'Type email and press Enter to add…'
                  : 'Add another…'
              }
              className="flex-1 min-w-[160px] bg-transparent border-none outline-none text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 py-1"
            />
          </div>
        </label>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// AttachTemplateModal — full-screen modal for picking a template
// to attach. Replaces the cramped dropdown so users can see multiple
// templates at once without scrolling through them one-at-a-time.
// ──────────────────────────────────────────────────────────────
function AttachTemplateModal({ allTemplates, availableTemplates, onClose, onSelect }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    // Prevent body scroll while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return availableTemplates;
    const q = query.trim().toLowerCase();
    return availableTemplates.filter((t) => {
      const hay = `${t.name} ${t.subject || ''} ${t.system_slug || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [availableTemplates, query]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              Attach a Template
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Click any template to attach it to this group. Groups can have multiple templates.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar */}
        {availableTemplates.length > 5 && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-slate-700">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates by name or subject..."
                autoFocus
                className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
              />
            </div>
          </div>
        )}

        {/* Body — scrollable template grid */}
        <div className="flex-1 overflow-y-auto">
          {availableTemplates.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <Mail className="w-12 h-12 mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              {allTemplates.length === 0 ? (
                <>
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
                    No templates exist yet
                  </div>
                  <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Create one in{' '}
                    <Link
                      href="/settings/communications/templates"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Email Templates
                    </Link>{' '}
                    first.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
                    All templates already attached
                  </div>
                  <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Every existing template is already in this group. Detach one to
                    re-attach it, or create a new template.
                  </div>
                </>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="text-sm text-gray-500 dark:text-slate-400">
                No templates match &quot;{query}&quot;
              </div>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className="text-left p-4 rounded-xl border-2 border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                        t.is_system
                          ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
                          : 'bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700'
                      }`}
                    >
                      {t.is_system ? (
                        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Mail className="w-5 h-5 text-gray-500 dark:text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate">
                          {t.name}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
                        {t.is_system && (
                          <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-1.5 py-0.5 rounded">
                            System
                          </span>
                        )}
                        <span
                          className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${
                            t.body_format === 'html'
                              ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-900/60'
                              : 'text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700'
                          }`}
                        >
                          {t.body_format === 'html' ? 'HTML' : 'Plain'}
                        </span>
                        {!t.is_active && (
                          <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2">
                        <span className="text-gray-400 dark:text-slate-500">
                          Subject:{' '}
                        </span>
                        {t.subject}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-slate-400">
            {availableTemplates.length > 0 && (
              <>
                Showing {filtered.length} of {availableTemplates.length} available template
                {availableTemplates.length === 1 ? '' : 's'} &middot;{' '}
                <Link
                  href="/settings/communications/templates"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Manage templates
                </Link>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// GroupSaveIndicator — little pill that flashes in the group header
// when the parent saves/errors out on a group mutation. idle renders
// nothing (minimal visual noise).
// ──────────────────────────────────────────────────────────────
function GroupSaveIndicator({ state }) {
  if (!state) return null;
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 animate-in fade-in">
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        Saved
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60">
        Save failed
      </span>
    );
  }
  return null;
}
