import { useEffect, useState } from 'react';
import { Package, Ruler, Truck, Box, Plus, Edit2, Trash2, GripVertical } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import SubTabs from '../../components/ui/SubTabs';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import { bustCache } from '../../components/ui/ReferenceDataPicker';

const TABS = [
  {
    id: 'container_types',
    label: 'Container Types',
    icon: Package,
    endpoint: '/api/tenant/container-types',
    description: 'Managed list of container types (Dry High Cube, Reefer, Flat Rack, etc.)',
  },
  {
    id: 'container_sizes',
    label: 'Container Sizes',
    icon: Ruler,
    endpoint: '/api/tenant/container-sizes',
    description: 'ISO + domestic container sizes (20\', 40\', 40HC, 45\', 48\', 53\')',
  },
  {
    id: 'chassis_types',
    label: 'Chassis Types',
    icon: Truck,
    endpoint: '/api/tenant/chassis-types',
    description: 'Chassis configurations (Standard, Tri-Axle, Gooseneck, Lowboy, etc.)',
  },
  {
    id: 'chassis_sizes',
    label: 'Chassis Sizes',
    icon: Ruler,
    endpoint: '/api/tenant/chassis-sizes',
    description: 'Chassis dimensions (20\', 40\', 20-40\', 48/53\', etc.)',
  },
];

const EMPTY_FORM = { code: '', label: '', description: '' };

function EquipmentReferenceSettings() {
  const [activeTab, setActiveTab] = useState('container_types');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [reorderFlash, setReorderFlash] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const currentTab = TABS.find((t) => t.id === activeTab);

  async function load() {
    if (!currentTab) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(currentTab.endpoint);
      if (!res.ok) throw new Error('Failed to load items');
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(item) {
    if (item.is_system) {
      setError('System entries cannot be edited. Create a custom one instead.');
      return;
    }
    setEditing(item);
    setForm({
      code: item.code || '',
      label: item.label || '',
      description: item.description || '',
    });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = editing ? `${currentTab.endpoint}/${editing.id}` : currentTab.endpoint;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save');
      }
      setModalOpen(false);
      bustCache(currentTab.endpoint);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item) {
    if (item.is_system) {
      setError('System entries cannot be deleted.');
      return;
    }
    if (!confirm(`Delete ${item.label}?`)) return;
    try {
      const res = await fetch(`${currentTab.endpoint}/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      bustCache(currentTab.endpoint);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggle(item) {
    const next = !(item.effective_enabled ?? item.is_enabled);
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, effective_enabled: next } : i))
    );
    try {
      const res = await fetch(`${currentTab.endpoint}/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to toggle');
      }
      bustCache(currentTab.endpoint);
    } catch (e) {
      setError(e.message);
      await load();
    }
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(items, oldIdx, newIdx);
    setItems(reordered);

    // Save new sort_order to the API
    const sortPayload = reordered.map((item, idx) => ({ id: item.id, sort_order: idx }));
    try {
      const res = await fetch(currentTab.endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sortPayload }),
      });
      if (!res.ok) throw new Error('Failed to save order');
      bustCache(currentTab.endpoint);
      // Green flash feedback
      setReorderFlash(true);
      setTimeout(() => setReorderFlash(false), 1000);
    } catch (e) {
      setError(e.message);
      await load(); // rollback
    }
  }

  const systemCount = items.filter((i) => i.is_system).length;
  const tenantCount = items.filter((i) => !i.is_system).length;

  return (
    <>
      <div className="max-w-5xl space-y-4">
        <PageHeader
          variant="plain"
          title={<><Box className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Equipment Reference</>}
          description="Manage the lookup lists for container types, container sizes, chassis types, and chassis sizes. These populate load-form dropdowns across the app."
          actions={
            <Button onClick={openNew}>
              <Plus className="w-4 h-4 mr-1 inline -mt-0.5" />
              Add {currentTab?.label.replace(' Types', ' Type').replace(' Sizes', ' Size')}
            </Button>
          }
          className="mb-[var(--space-section)]"
        />

        <SettingsTabs />

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
        {reorderFlash && (
          <div className="text-helper text-emerald-600 font-medium bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 transition-all">
            Order saved — dropdowns across the app will reflect this order.
          </div>
        )}

        <SubTabs
          tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
          active={activeTab}
          onChange={setActiveTab}
        />

        <div className="flex gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">System</div>
            <div className="text-xl font-bold text-strong">{systemCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">Custom</div>
            <div className="text-xl font-bold text-strong">{tenantCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">Total</div>
            <div className="text-xl font-bold text-strong">{items.length}</div>
          </div>
        </div>

        <SectionCard
          title={currentTab?.label}
          description={currentTab?.description}
          columns={0}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/50 text-field-label text-muted">
                    <tr>
                      <th className="w-10"></th>
                      <th className="text-left px-4 py-2 w-32">Code</th>
                      <th className="text-left px-4 py-2">Label</th>
                      <th className="text-left px-4 py-2">Description</th>
                      <th className="text-left px-4 py-2 w-24">Source</th>
                      <th className="text-center px-4 py-2 w-20">Enabled</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-helper text-muted">
                          Loading...
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-helper text-muted">
                          No entries yet.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <SortableRow
                          key={item.id}
                          item={item}
                          onToggle={handleToggle}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </SortableContext>
          </DndContext>
        </SectionCard>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.label}` : `Add Custom ${currentTab?.label.replace(/s$/, '')}`}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            required
            placeholder="e.g. DR HC"
            helpText="Short code (2-8 characters, typically uppercase)"
          />
          <Input
            label="Label"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            required
            placeholder="e.g. Dry High Cube"
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Optional details"
          />
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
            <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Add Entry'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

EquipmentReferenceSettings.getLayout = (page) => (
  <SettingsLayout title="Equipment Reference Data">{page}</SettingsLayout>
);

export default EquipmentReferenceSettings;

// ===== Sortable table row =====
function SortableRow({ item, onToggle, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 50 : 'auto',
  };

  const isEnabled = item.effective_enabled ?? item.is_enabled;

  return (
    <tr ref={setNodeRef} style={style} className={`hover:bg-gray-50 dark:hover:bg-slate-800/60 ${isEnabled ? '' : 'opacity-50'}`}>
      <td className="px-2 py-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400 p-1"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </td>
      <td className="px-4 py-2">
        <span className="text-[10px] uppercase tracking-wide font-mono font-semibold bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 px-1.5 py-0.5 rounded">
          {item.code}
        </span>
      </td>
      <td className="px-4 py-2 font-medium text-body text-strong">{item.label}</td>
      <td className="px-4 py-2 text-helper text-muted">{item.description || '—'}</td>
      <td className="px-4 py-2">
        {item.is_system ? (
          <span className="text-field-label text-muted">system</span>
        ) : (
          <span className="text-field-label font-semibold text-blue-700">custom</span>
        )}
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={() => onToggle(item)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              isEnabled ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </td>
      <td className="px-2 py-2 text-right">
        {!item.is_system && (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => onEdit(item)} className="text-gray-400 dark:text-slate-500 hover:text-blue-600" title="Edit">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(item)} className="text-gray-300 dark:text-slate-600 hover:text-red-500" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
