import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import Button from '../../ui/Button';
import Badge from '../../ui/Badge';
import { getCombinationRuleLabel } from '../../../lib/ar-utils';
import NotifyPartyPicker from '../../loads/NotifyPartyPicker';

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-sm text-gray-900 dark:text-slate-100 mt-0.5">{value || '—'}</div>
    </div>
  );
}

export default function OverviewTab({ organization, onEdit }) {
  const o = organization;

  const [defaults, setDefaults] = useState([]);
  const [defaultsDirty, setDefaultsDirty] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const raw = o?.default_notify_parties || [];
    if (!Array.isArray(raw) || raw.length === 0) {
      setDefaults([]);
      return;
    }

    // Hydrate names — fetch each unique source-org's groups + contacts
    (async () => {
      const orgIds = Array.from(
        new Set(raw.map((d) => d.source_organization_id || o.id).filter(Boolean))
      );
      const orgDataById = {};
      await Promise.all(
        orgIds.map(async (oid) => {
          const [info, groups, contacts] = await Promise.all([
            fetch(`/api/tenant/organizations/${oid}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
            fetch(`/api/tenant/organizations/${oid}/groups`)
              .then((r) => (r.ok ? r.json() : { groups: [] }))
              .catch(() => ({ groups: [] })),
            fetch(`/api/tenant/organizations/${oid}/contacts`)
              .then((r) => (r.ok ? r.json() : { contacts: [] }))
              .catch(() => ({ contacts: [] })),
          ]);
          orgDataById[oid] = {
            name: info?.organization?.name || 'Unknown',
            groupById: Object.fromEntries((groups.groups || []).map((g) => [g.id, g])),
            contactById: Object.fromEntries((contacts.contacts || []).map((c) => [c.id, c])),
          };
        })
      );
      if (cancelled) return;

      const hydrated = raw.map((d) => {
        const oid = d.source_organization_id || o.id;
        const data = orgDataById[oid];
        if (!data) {
          return {
            party_type: d.type,
            party_id: d.id,
            source: 'customer',
            source_organization_id: oid,
            source_organization_name: 'Unknown',
            name: null,
          };
        }
        if (d.type === 'group') {
          const g = data.groupById[d.id];
          return {
            party_type: 'group',
            party_id: d.id,
            source: 'customer',
            source_organization_id: oid,
            source_organization_name: data.name,
            name: g?.name || null,
            member_count: g?.member_count ?? null,
          };
        }
        const c = data.contactById[d.id];
        const name = c
          ? (c.first_name || c.last_name)
            ? `${c.first_name || ''} ${c.last_name || ''}`.trim()
            : (c.email || '(unnamed)')
          : null;
        return {
          party_type: 'contact',
          party_id: d.id,
          source: 'customer',
          source_organization_id: oid,
          source_organization_name: data.name,
          name,
          email: c?.email || null,
        };
      });
      setDefaults(hydrated);
      setDefaultsDirty(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [o]);

  async function saveDefaults() {
    setSavingDefaults(true);
    const payload = defaults.map((p) => ({
      type: p.party_type,
      id: p.party_id,
      source_organization_id: p.source_organization_id,
    }));
    try {
      const res = await fetch(`/api/tenant/organizations/${o.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_notify_parties: payload }),
      });
      if (res.ok) {
        setDefaultsDirty(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to save: ${err.error || res.statusText}`);
      }
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSavingDefaults(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onEdit}>
          <Pencil className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
          Edit Organization
        </Button>
      </div>

      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-4">Identity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Name" value={o.name} />
          <Field label="Market" value={o.market} />
          <Field label="MC Number" value={o.mc_number} />
          <Field
            label="Types"
            value={
              <div className="flex flex-wrap gap-1 mt-1">
                {(o.customer_types || []).map((t) => (
                  <Badge key={t} variant="blue">
                    {t}
                  </Badge>
                ))}
              </div>
            }
          />
          <Field
            label="Status"
            value={<Badge variant={o.status === 'active' ? 'green' : 'gray'}>{o.status}</Badge>}
          />
          <Field label="Created" value={new Date(o.created_at).toLocaleDateString()} />
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-4">Address</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Street" value={o.address_line1} />
          <Field label="City" value={o.city} />
          <Field label="State" value={o.state} />
          <Field label="Zip" value={o.zip} />
          <Field label="Country" value={o.country} />
          <Field label="Main Phone" value={o.main_phone || o.phone} />
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-4">Email</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Billing Email" value={o.billing_email} />
          <Field label="Receiver Email" value={o.receiver_email} />
          <Field label="QuickBooks Email" value={o.quickbooks_email} />
          <Field label="Company Domain" value={o.company_domain} />
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-4">Payment</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field
            label="Credit Limit"
            value={
              o.credit_limit_cents
                ? `$${(o.credit_limit_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                : '—'
            }
          />
          <Field label="Currency" value={o.currency} />
          <Field label="Payment Terms" value={o.payment_terms ? `${o.payment_terms} days` : '—'} />
          <Field label="Payment Method" value={o.payment_term_method} />
          <Field label="Terms From" value={o.payment_terms_from?.replace('_', ' ')} />
          <Field label="Invoice Combination" value={getCombinationRuleLabel(o.invoice_combination_rule)} />
          <Field
            label="Account Hold"
            value={
              o.account_hold ? (
                <Badge variant="red">On Hold</Badge>
              ) : (
                <Badge variant="green">Active</Badge>
              )
            }
          />
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-4">Contact</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Main Contact" value={o.main_contact_name} />
          <Field label="Main Phone" value={o.main_phone} />
          <Field label="Secondary Contact" value={o.secondary_contact_name} />
          <Field label="Secondary Phone" value={o.secondary_phone} />
          <Field label="Office Hours Start" value={o.office_hour_start} />
          <Field label="Office Hours End" value={o.office_hour_end} />
        </div>
      </section>

      <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
              Default notify parties for new loads
            </div>
            <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5">
              Auto-populated when a new load is created for this customer. Editable per-load.
            </div>
          </div>
          {defaultsDirty && (
            <button
              type="button"
              onClick={saveDefaults}
              disabled={savingDefaults}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-50"
            >
              {savingDefaults ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        <div className="p-4">
          <NotifyPartyPicker
            mode="customer-default"
            customerId={o.id}
            value={defaults}
            onChange={(next) => {
              setDefaults(next);
              setDefaultsDirty(true);
            }}
          />
        </div>
      </div>

      {o.portal_enabled && (
        <section className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-4">Customer Portal Enabled</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Portal Admin Email" value={o.portal_admin_email} />
            <Field
              label="Can Edit Loads"
              value={o.can_edit_load ? <Badge variant="green">Yes</Badge> : <Badge variant="gray">No</Badge>}
            />
          </div>
        </section>
      )}

      {o.notes && (
        <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">Internal Notes</h3>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{o.notes}</p>
        </section>
      )}
    </div>
  );
}
