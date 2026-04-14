import Link from 'next/link';
import { Building2, MapPin, ArrowRight, Map as MapIcon } from 'lucide-react';

/**
 * LoadSidebar — PortPro-style dense left rail for the load detail page.
 *
 * Sections (top to bottom):
 *   1. Customer
 *   2. Pick Up Location
 *   3. Delivery Location
 *   4. Return Location
 *   5. Load Info Summary (compact key-value list)
 *   6. Map placeholder
 *
 * Designed to sit in a sticky container beside the tab content. Width is
 * fixed at ~280px so the right pane gets the rest of the viewport.
 */

function formatDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return d;
  }
}

function SectionLabel({ children }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">
      {children}
    </div>
  );
}

function LocationBlock({ label, org }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {org ? (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
          <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate">{org.name}</div>
          {(org.address_line1 || org.city) && (
            <div className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight mt-0.5">
              {[org.address_line1, org.city, org.state, org.zip]
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-3 py-2 text-[11px] text-gray-400 dark:text-slate-500 text-center">
          Not set
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1 text-[11px] border-b border-gray-100 dark:border-slate-800 last:border-b-0">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="text-gray-900 dark:text-slate-100 font-medium text-right truncate ml-2 max-w-[60%]">
        {value || <span className="text-gray-300 dark:text-slate-600">—</span>}
      </span>
    </div>
  );
}

export default function LoadSidebar({ load }) {
  if (!load) return null;

  const driverName =
    load.driver &&
    ([load.driver.first_name, load.driver.last_name].filter(Boolean).join(' ') ||
      load.driver.name);

  const createdBy = load.created_by_user?.name || load.created_by_user?.email || null;

  return (
    <aside className="w-full md:w-[280px] md:shrink-0 space-y-3">
      {/* Customer */}
      <div>
        <SectionLabel>Customer</SectionLabel>
        {load.customer ? (
          <Link
            href={`/organizations/${load.customer.id}`}
            className="block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-gray-900 dark:text-slate-100 truncate">
                  {load.customer.name}
                </div>
                {load.customer.city && (
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                    {[load.customer.city, load.customer.state].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
              <ArrowRight className="w-3 h-3 text-gray-300 dark:text-slate-600" />
            </div>
          </Link>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-3 py-2 text-[11px] text-gray-400 dark:text-slate-500 text-center">
            Not set
          </div>
        )}
      </div>

      {/* Pick Up Location */}
      <LocationBlock
        label={
          load.load_type === 'export' || load.load_type === 'outbound'
            ? 'Empty Pickup'
            : 'Pick Up Location'
        }
        org={load.pickup_org}
      />

      {/* Delivery Location */}
      <LocationBlock
        label={
          load.load_type === 'export' || load.load_type === 'outbound'
            ? 'Loading Warehouse'
            : 'Delivery Location'
        }
        org={load.delivery_org}
      />

      {/* Return Location */}
      {load.return_org && <LocationBlock label="Return Location" org={load.return_org} />}

      {/* Load Info Summary — compact key/value */}
      <div>
        <SectionLabel>Load Info Summary</SectionLabel>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1">
          <SummaryRow label="Created By" value={createdBy} />
          <SummaryRow label="Created Date" value={formatDate(load.created_at)} />
          <SummaryRow label="Container #" value={load.container_number} />
          <SummaryRow label="BOL #" value={load.bill_of_lading} />
          <SummaryRow label="Chassis #" value={load.chassis_number} />
          <SummaryRow
            label="SSL"
            value={load.container_owner?.name || load.container_owner?.label || load.steamship_line}
          />
          <SummaryRow label="Size" value={load.container_size} />
          <SummaryRow
            label="Weight"
            value={
              load.weight_lbs
                ? `${load.weight_lbs} lbs`
                : load.weight_kg
                  ? `${load.weight_kg} kg`
                  : null
            }
          />
          <SummaryRow label="Type" value={load.container_type} />
          <SummaryRow label="Commodity" value={load.commodity_description} />
          <SummaryRow label="Reference" value={load.reference_number} />
          <SummaryRow label="Driver" value={driverName} />
        </div>
      </div>

      {/* Map placeholder */}
      <div>
        <SectionLabel>Preview</SectionLabel>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 h-32 flex flex-col items-center justify-center text-center">
          <MapIcon className="w-5 h-5 text-gray-300 dark:text-slate-600 mb-1" />
          <div className="text-[10px] font-semibold text-gray-500 dark:text-slate-400">Route Map</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">Coming soon</div>
        </div>
      </div>
    </aside>
  );
}
