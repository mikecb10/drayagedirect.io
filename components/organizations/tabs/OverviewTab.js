import { Pencil } from 'lucide-react';
import Button from '../../ui/Button';
import Badge from '../../ui/Badge';
import { getCombinationRuleLabel } from '../../../lib/ar-utils';

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
