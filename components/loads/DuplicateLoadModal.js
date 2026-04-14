import { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';

/**
 * DuplicateLoadModal — "How many copies do you want to create?"
 *
 * Creates N copies of a load with the same routing template, customer,
 * locations, equipment, and flags. Does NOT copy container #, seal #,
 * driver, dates, or status (all reset to fresh pending loads).
 */
export default function DuplicateLoadModal({ isOpen, onClose, load, onSuccess }) {
  const [count, setCount] = useState(1);
  const [skipPricing, setSkipPricing] = useState(false);
  const [skipNotes, setSkipNotes] = useState(true);
  const [withRouting, setWithRouting] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (count < 1 || count > 50) return;
    setCreating(true);
    setError(null);

    try {
      const results = [];
      for (let i = 0; i < count; i++) {
        const payload = {
          customer_id: load.customer_id,
          load_type: load.load_type,
          routing_template_id: withRouting ? load.routing_template_id : null,
          routing_template_name: withRouting ? load.routing_template_name : null,
          pickup_location_id: load.pickup_location_id,
          delivery_location_id: load.delivery_location_id,
          return_location_id: load.return_location_id,
          final_delivery_location_id: load.final_delivery_location_id,
          // Equipment (but NOT container # or seal #)
          container_size: load.container_size,
          container_size_id: load.container_size_id,
          container_type: load.container_type,
          container_type_id: load.container_type_id,
          container_owner_id: load.container_owner_id,
          chassis_size: load.chassis_size,
          chassis_size_id: load.chassis_size_id,
          chassis_type: load.chassis_type,
          chassis_type_id: load.chassis_type_id,
          // Reference numbers
          bill_of_lading: load.bill_of_lading,
          booking_number: load.booking_number,
        };

        const res = await fetch('/api/tenant/loads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to create copy ${i + 1}`);
        }

        const data = await res.json();
        results.push(data.load);
      }

      onSuccess?.(results);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Duplicate This Load" size="sm">
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            How many copies to create?
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            className="block w-24 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </div>

        <div className="space-y-2">
          <Checkbox
            checked={skipPricing}
            onChange={setSkipPricing}
            label="Do Not Carry Over Pricing"
          />
          <Checkbox
            checked={skipNotes}
            onChange={setSkipNotes}
            label="Do Not Carry Over Driver & Billing Notes"
          />
          <Checkbox
            checked={withRouting}
            onChange={setWithRouting}
            label="Create With Routing Template"
          />
        </div>

        <div className="rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2 text-[11px] text-gray-500 dark:text-slate-400 space-y-0.5">
          <div><strong>Will copy:</strong> Customer, locations, equipment type/size, routing template, BOL, booking #</div>
          <div><strong>Will NOT copy:</strong> Container #, seal #, driver, dates, status, holds (reset to released)</div>
          <div><strong>Each copy gets:</strong> A new unique load number</div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={creating}>
            {count === 1 ? 'Create Copy' : `Create ${count} Copies`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
