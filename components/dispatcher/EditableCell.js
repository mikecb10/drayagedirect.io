import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Copy, Check } from 'lucide-react';
import CellPopover from './CellPopover';
import OrgPicker from '../ui/OrgPicker';
import DriverPicker from '../ui/DriverPicker';
import ReferenceDataPicker from '../ui/ReferenceDataPicker';
import ContainerOwnerPicker from '../ui/ContainerOwnerPicker';
import DateTimePicker from '../ui/DateTimePicker';
import { useTenantTimeFormat } from '../../hooks/useTenantSettings';

/**
 * EditableCell — wraps a dispatcher board cell and makes it interactive
 * based on the column's `interaction` config.
 *
 * Interaction types:
 *   { type: 'edit', field, inputType }                 → inline input
 *   { type: 'copy', field }                            → copy to clipboard
 *   { type: 'select', field, options }                 → native select
 *   { type: 'date', field, dateType: 'date'|'datetime-local' } → date picker
 *   { type: 'orgPicker', field, orgType }              → organization picker
 *   { type: 'driverPicker', field }                    → driver picker
 *   { type: 'refPicker', field, endpoint, codeField, labelField } → ref data picker
 *   { type: 'containerOwnerPicker', field }            → steamship line picker
 *   { type: 'link', field, hrefTemplate }              → navigates on click
 *   none / undefined                                   → display only
 *
 * Green flash on successful save, red flash on error.
 */
export default function EditableCell({ column, row, onSave, children }) {
  const router = useRouter();
  const cellRef = useRef(null);
  const interaction = column.interaction;
  const use24h = useTenantTimeFormat();

  const [editing, setEditing] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [flash, setFlash] = useState(null); // 'success' | 'error' | null

  // Tracks whether the user has picked a date in the datetime picker but
  // hasn't yet picked a time. Used to delay closing the popover until BOTH
  // parts of a datetime-local value have been chosen. Reset when the popover
  // closes so a fresh edit starts cleanly.
  const datePickedRef = useRef(false);
  useEffect(() => {
    if (!popoverOpen) datePickedRef.current = false;
  }, [popoverOpen]);

  // No interaction: just display the content
  if (!interaction || interaction.type === 'none') {
    return children;
  }

  function triggerFlash(kind) {
    setFlash(kind);
    setTimeout(() => setFlash(null), 900);
  }

  async function doSave(patch) {
    try {
      await onSave(row.id, patch);
      triggerFlash('success');
    } catch (e) {
      triggerFlash('error');
    }
  }

  // ===== Interaction handlers =====

  async function handleCellClick(e) {
    // Let dispatch/remove/open-load clicks bubble through to the board's event delegation
    if (e.target.closest('[data-dispatch]') || e.target.closest('[data-remove-driver]') || e.target.closest('[data-open-load]')) {
      return; // don't stop propagation — let board handle these
    }
    e.stopPropagation();

    if (interaction.type === 'copy') {
      const value = row[interaction.field];
      if (value) {
        try {
          await navigator.clipboard.writeText(String(value));
          triggerFlash('success');
        } catch {
          triggerFlash('error');
        }
      }
      return;
    }

    if (interaction.type === 'link' && interaction.hrefTemplate) {
      const id = row[interaction.idField || 'id'];
      if (id) router.push(interaction.hrefTemplate.replace('{id}', id));
      return;
    }

    if (interaction.type === 'edit') {
      setEditing(true);
      return;
    }

    // All picker types + select + date: open popover
    setPopoverOpen(true);
  }

  // ===== Edit mode (inline input) =====

  if (editing) {
    return (
      <EditInput
        row={row}
        interaction={interaction}
        onSave={async (val) => {
          setEditing(false);
          await doSave({ [interaction.field]: val });
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // ===== Popover content per picker type =====

  function renderPopover() {
    if (!popoverOpen) return null;

    const close = () => setPopoverOpen(false);
    const saveAndClose = async (patch) => {
      close();
      await doSave(patch);
    };

    if (interaction.type === 'select') {
      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={220}>
          {/*
            [color-scheme:dark] is critical here — without it Chrome/Edge render
            the native <option> dropdown list with a light background regardless
            of Tailwind classes, because the option popup is an OS-level UI.
            Setting color-scheme tells the browser to use the dark native widget.
          */}
          <select
            autoFocus
            defaultValue={row[interaction.field] || ''}
            onChange={(e) => saveAndClose({ [interaction.field]: e.target.value })}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 dark:[color-scheme:dark]"
          >
            <option value="">—</option>
            {(interaction.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </CellPopover>
      );
    }

    if (interaction.type === 'date') {
      const showTime = (interaction.dateType || 'date') === 'datetime-local';
      // Wider popover so the calendar + time selector layout fits comfortably
      const popWidth = showTime ? 480 : 320;

      // DateTimePicker's onChange fires TWICE in showTime mode:
      //   1) Date click → emits YYYY-MM-DDTHH:mm with the currently-selected
      //      (or default 00:00) time. We save this partial value but keep the
      //      popover open so the user can still pick a time.
      //   2) Time click → emits YYYY-MM-DDTHH:mm with the chosen time. We
      //      save AND close the popover. (The DateTimePicker also collapses
      //      its own internal open state after this, so closing is required.)
      //
      // In showTime=false mode, a single date click is the final value —
      // save and close immediately.
      const handleDateChange = async (v) => {
        if (!showTime) {
          await saveAndClose({ [interaction.field]: v || null });
          return;
        }
        if (!datePickedRef.current) {
          // First emit = date picked → partial save, keep open
          datePickedRef.current = true;
          await doSave({ [interaction.field]: v || null });
        } else {
          // Second emit = time picked → final save + close
          await saveAndClose({ [interaction.field]: v || null });
        }
      };

      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={popWidth}>
          <DateTimePicker
            value={row[interaction.field] || null}
            onChange={handleDateChange}
            showTime={showTime}
            use24h={use24h}
            autoOpen
          />
        </CellPopover>
      );
    }

    if (interaction.type === 'orgPicker') {
      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={280}>
          <OrgPicker
            type={interaction.orgType}
            value={row[interaction.field]}
            valueLabel={getNestedLabel(row, interaction.labelPath)}
            onChange={(org) => {
              saveAndClose({ [interaction.field]: org?.id || null });
            }}
          />
        </CellPopover>
      );
    }

    if (interaction.type === 'driverPicker' || interaction.type === 'driverInline') {
      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={260}>
          <DriverPicker
            value={row[interaction.field]}
            onChange={(driverId) => saveAndClose({ [interaction.field]: driverId })}
            autoOpen
          />
        </CellPopover>
      );
    }

    if (interaction.type === 'refPicker') {
      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={280}>
          <ReferenceDataPicker
            endpoint={interaction.endpoint}
            value={row[interaction.field]}
            valueLabel={row[interaction.displayField]}
            onChange={(item) => {
              const patch = { [interaction.field]: item?.id || null };
              // Also update snapshot text field if provided
              if (interaction.displayField && item) {
                patch[interaction.displayField] = item[interaction.snapshotFrom || 'label'];
              } else if (interaction.displayField) {
                patch[interaction.displayField] = '';
              }
              saveAndClose(patch);
            }}
          />
        </CellPopover>
      );
    }

    if (interaction.type === 'containerOwnerPicker') {
      return (
        <CellPopover anchorEl={cellRef.current} onClose={close} width={300}>
          <ContainerOwnerPicker
            value={row.container_owner_id}
            valueLabel={row.steamship_line}
            onChange={(owner) => {
              const patch = { container_owner_id: owner?.id || null };
              if (owner) {
                patch.steamship_line = owner.label || owner.name;
                patch.steamship_line_scac = owner.scac_code || '';
              } else {
                patch.steamship_line = '';
                patch.steamship_line_scac = '';
              }
              saveAndClose(patch);
            }}
          />
        </CellPopover>
      );
    }

    return null;
  }

  // ===== Flash styling =====

  const flashClass =
    flash === 'success'
      ? 'bg-green-200/80 ring-1 ring-green-400'
      : flash === 'error'
      ? 'bg-red-200/80 ring-1 ring-red-400'
      : '';

  const cursorClass =
    interaction.type === 'copy'
      ? 'cursor-pointer'
      : interaction.type === 'link'
      ? 'cursor-pointer'
      : 'cursor-pointer';

  const hoverClass =
    flash === null ? 'hover:bg-black/5 hover:ring-1 hover:ring-gray-300' : '';

  return (
    <>
      <div
        ref={cellRef}
        onClick={handleCellClick}
        className={`rounded px-1 -mx-1 transition-all duration-300 ${cursorClass} ${hoverClass} ${flashClass}`}
        title={
          interaction.type === 'copy'
            ? 'Click to copy'
            : interaction.type === 'edit'
            ? 'Click to edit'
            : interaction.type === 'link'
            ? 'Click to navigate'
            : 'Click to change'
        }
      >
        {children}
        {flash === 'success' && interaction.type === 'copy' && (
          <Check className="w-3 h-3 text-green-600 inline ml-1" />
        )}
      </div>
      {renderPopover()}
    </>
  );
}

// ===== Helpers =====

function EditInput({ row, interaction, onSave, onCancel }) {
  const initial = row[interaction.field] ?? '';
  const [value, setValue] = useState(initial);

  return (
    <input
      type={interaction.inputType || 'text'}
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const parsed = parseByType(value, interaction.inputType);
        if (parsed !== initial) onSave(parsed);
        else onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const parsed = parseByType(value, interaction.inputType);
          if (parsed !== initial) onSave(parsed);
          else onCancel();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full rounded border border-blue-500 bg-white dark:bg-slate-950 px-1.5 py-0.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/60"
    />
  );
}

function parseByType(value, type) {
  if (value === '' || value === null || value === undefined) return null;
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return value;
}

function formatDateValue(v, dateType) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (dateType === 'datetime-local') {
      const tz = d.getTimezoneOffset() * 60000;
      return new Date(d - tz).toISOString().slice(0, 16);
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function getNestedLabel(row, path) {
  if (!path) return '';
  return path.split('.').reduce((acc, key) => acc?.[key], row) || '';
}
