import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import Alert from '../ui/Alert';

const PURPOSE_OPTIONS = [
  { value: 'billing', label: 'Billing' },
  { value: 'operations', label: 'Operations' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'rate_confirmation', label: 'Rate Confirmation' },
  { value: 'management', label: 'Management' },
  { value: 'custom', label: 'Custom' },
];

const EMPTY = {
  name: '',
  purpose: 'custom',
  is_default_for_purpose: false,
  description: '',
};

export default function GroupModal({ isOpen, onClose, onSuccess, orgId, editing = null }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setForm(editing ? { ...EMPTY, ...editing } : EMPTY);
    }
  }, [isOpen, editing]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = editing
        ? `/api/tenant/organizations/${orgId}/groups/${editing.id}`
        : `/api/tenant/organizations/${orgId}/groups`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save group');
      }
      const data = await res.json();
      onSuccess?.(data.group);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? 'Edit Group' : 'Create Group'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <Input
          label="Group Name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
          placeholder="e.g. Billing Team"
        />

        <Select
          label="Purpose"
          value={form.purpose}
          onChange={(e) => update('purpose', e.target.value)}
          options={PURPOSE_OPTIONS}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Description</label>
          <textarea
            value={form.description || ''}
            onChange={(e) => update('description', e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
            placeholder="What is this group for?"
          />
        </div>

        <Checkbox
          checked={form.is_default_for_purpose}
          onChange={(v) => update('is_default_for_purpose', v)}
          label="Default group for this purpose"
          description="Auto-populate this group when sending emails of the matching type"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Create Group'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
