import { useEffect, useState } from 'react';
import { Plus, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import DataTable from '../ui/DataTable';
import StatsCards from '../ui/StatsCards';
import FilterBar from '../ui/FilterBar';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Alert from '../ui/Alert';
import EquipmentModal from './EquipmentModal';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function isExpired(date) {
  if (!date) return false;
  return new Date(date) < new Date();
}

function isExpiringSoon(date) {
  if (!date) return false;
  const days = (new Date(date) - new Date()) / (1000 * 60 * 60 * 24);
  return days > 0 && days < 30;
}

function ExpCell({ date }) {
  if (!date) return <span className="text-gray-400">—</span>;
  const expired = isExpired(date);
  const soon = isExpiringSoon(date);
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        expired ? 'text-red-600 font-medium' : soon ? 'text-amber-600' : 'text-gray-700'
      }`}
    >
      {(expired || soon) && <AlertTriangle className="w-3 h-3" />}
      {formatDate(date)}
    </span>
  );
}

/**
 * Generic equipment list view. Configured via `type` prop.
 * type: 'trucks' | 'chassis' | 'trailers'
 */
const CONFIGS = {
  trucks: {
    key: 'trucks',
    responseKey: 'trucks',
    singular: 'Truck',
    plural: 'Trucks',
    numberField: 'truck_number',
    columns: [
      { key: 'truck_number', label: 'Truck #', sortable: true },
      { key: 'truck_owner', label: 'Owner' },
      { key: 'license_plate', label: 'License Plate' },
      { key: 'license_plate_state', label: 'State' },
      { key: 'vin', label: 'VIN' },
      {
        key: 'registration_exp',
        label: 'Registration',
        render: (r) => <ExpCell date={r.registration_exp} />,
      },
      {
        key: 'annual_inspection_date',
        label: 'AID',
        render: (r) => <ExpCell date={r.annual_inspection_date} />,
      },
      {
        key: 'hut_exp',
        label: 'HUT',
        render: (r) => <ExpCell date={r.hut_exp} />,
      },
    ],
  },
  chassis: {
    key: 'chassis',
    responseKey: 'chassis',
    singular: 'Chassis',
    plural: 'Chassis',
    numberField: 'chassis_number',
    columns: [
      { key: 'chassis_number', label: 'Chassis #', sortable: true },
      { key: 'chassis_owner', label: 'Owner' },
      { key: 'chassis_type', label: 'Type' },
      { key: 'chassis_size', label: 'Size' },
      { key: 'license_plate', label: 'License Plate' },
      {
        key: 'registration_exp',
        label: 'Registration',
        render: (r) => <ExpCell date={r.registration_exp} />,
      },
      {
        key: 'inspection_exp',
        label: 'Inspection',
        render: (r) => <ExpCell date={r.inspection_exp} />,
      },
    ],
  },
  trailers: {
    key: 'trailers',
    responseKey: 'trailers',
    singular: 'Trailer',
    plural: 'Trailers',
    numberField: 'trailer_number',
    columns: [
      { key: 'trailer_number', label: 'Trailer #', sortable: true },
      { key: 'trailer_owner', label: 'Owner' },
      { key: 'trailer_type', label: 'Type' },
      { key: 'license_plate', label: 'License Plate' },
      { key: 'license_plate_state', label: 'State' },
      {
        key: 'registration_exp',
        label: 'Registration',
        render: (r) => <ExpCell date={r.registration_exp} />,
      },
    ],
  },
};

export default function EquipmentListView({ type }) {
  const config = CONFIGS[type];
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, enabled: 0, disabled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState('true');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (enabledFilter) params.set('enabled', enabledFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/equipment/${type}?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load ${config.plural.toLowerCase()}`);
      const data = await res.json();
      setItems(data[config.responseKey] || []);
      setStats(data.stats || { total: 0, enabled: 0, disabled: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [type, search, enabledFilter]);

  async function handleDelete(item) {
    if (!confirm(`Delete ${config.singular.toLowerCase()} "${item[config.numberField]}"?`)) return;
    try {
      const res = await fetch(`/api/tenant/equipment/${type}/${item.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const rowActions = (row) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => {
          setEditing(row);
          setModalOpen(true);
        }}
        className="p-1 text-gray-400 hover:text-blue-600"
        title="Edit"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleDelete(row)}
        className="p-1 text-gray-400 hover:text-red-600"
        title="Delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{config.plural}</h2>
          <p className="text-sm text-gray-500">
            {stats.total} total, {stats.enabled} enabled
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
          Add {config.singular}
        </Button>
      </div>

      <StatsCards
        cards={[
          { key: 'enabled', label: 'Enabled', count: stats.enabled, color: 'green' },
          { key: 'disabled', label: 'Disabled', count: stats.disabled, color: 'slate' },
          { key: 'total', label: 'Total', count: stats.total, color: 'blue' },
        ]}
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder={`Search ${config.plural.toLowerCase()}...`}
      />

      {error && <Alert type="error" message={error} />}

      <DataTable
        columns={config.columns}
        data={items}
        loading={loading}
        emptyMessage={`No ${config.plural.toLowerCase()} yet. Click "Add ${config.singular}" to add your first one.`}
        rowActions={rowActions}
        onRowClick={(row) => {
          setEditing(row);
          setModalOpen(true);
        }}
      />

      <EquipmentModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          load();
        }}
        type={type}
        editing={editing}
      />
    </div>
  );
}
