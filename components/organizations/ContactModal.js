import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Checkbox from '../ui/Checkbox';
import FormSection from '../ui/FormSection';
import Alert from '../ui/Alert';

const ROLE_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'billing', label: 'Billing' },
  { value: 'operations', label: 'Operations' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'management', label: 'Management' },
];

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  role: 'primary',
  is_primary: false,
  notes: '',
};

export default function ContactModal({ isOpen, onClose, onSuccess, orgId, editing = null }) {
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
        ? `/api/tenant/organizations/${orgId}/contacts/${editing.id}`
        : `/api/tenant/organizations/${orgId}/contacts`;
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save contact');
      }
      const data = await res.json();
      onSuccess?.(data.contact);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? 'Edit Contact' : 'Add Contact'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <FormSection columns={2}>
          <Input
            label="Full Name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            required
          />
          <Select
            label="Role"
            value={form.role}
            onChange={(e) => update('role', e.target.value)}
            options={ROLE_OPTIONS}
          />
          <Input
            label="Email"
            type="email"
            value={form.email || ''}
            onChange={(e) => update('email', e.target.value)}
          />
          <Input
            label="Phone"
            value={form.phone || ''}
            onChange={(e) => update('phone', e.target.value)}
          />
        </FormSection>

        <Checkbox
          checked={form.is_primary}
          onChange={(v) => update('is_primary', v)}
          label="Primary contact"
          description="Mark this person as the primary contact for the organization"
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Notes</label>
          <textarea
            value={form.notes || ''}
            onChange={(e) => update('notes', e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {editing ? 'Save Changes' : 'Add Contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
