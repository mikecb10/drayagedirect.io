import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Search, Users, User } from 'lucide-react';

/**
 * Shared chip-picker for load notify parties.
 *
 * Used in:
 *   - NewLoadModal (mode="load") — auto-populates from customer defaults
 *   - LoadInfoTab    (mode="load") — edits via API endpoints
 *   - OverviewTab    (mode="customer-default") — sets per-customer defaults
 *
 * Props:
 *   mode: 'load' | 'customer-default'
 *   customerId: uuid                 — load mode: bill-to customer; customer-default mode: this org
 *   pickupLocationOrgId, deliveryLocationOrgId, returnLocationOrgId: uuid (load mode only)
 *   value: array of party records
 *   onChange: (newValue) => void
 *   onManualEdit: () => void         — called whenever user adds/removes
 *
 * API shapes this component depends on:
 *   GET /api/tenant/organizations        → { organizations: [...], stats }  (search via ?search=)
 *   GET /api/tenant/organizations/[id]   → { organization: { id, name, ... } }
 *   GET /api/tenant/organizations/[id]/groups   → { groups: [{ id, name, member_count, ... }] }
 *   GET /api/tenant/organizations/[id]/contacts → { contacts: [{ id, first_name, last_name, email, ... }] }
 */

// ── Helper: derive display name from a contact row ────────────
function contactDisplayName(c) {
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : c.email || '(unnamed)';
}

export default function NotifyPartyPicker({
  mode = 'load',
  customerId,
  pickupLocationOrgId,
  deliveryLocationOrgId,
  returnLocationOrgId,
  value = [],
  onChange,
  onManualEdit,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [orgSections, setOrgSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchSelected, setSearchSelected] = useState(null);
  const [loadingSections, setLoadingSections] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState(null);

  // ── Fetch the predefined sections ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadSections() {
      setLoadingSections(true);
      const sections = [];
      const ids = mode === 'load'
        ? [
            { source: 'customer', label: 'Customer', orgId: customerId },
            { source: 'pickup_location', label: 'Pickup', orgId: pickupLocationOrgId },
            { source: 'delivery_location', label: 'Delivery', orgId: deliveryLocationOrgId },
            { source: 'return_location', label: 'Return', orgId: returnLocationOrgId },
          ]
        : [
            { source: 'customer', label: 'This organization', orgId: customerId },
          ];

      for (const s of ids) {
        if (!s.orgId) continue;
        const [orgRes, groupsRes, contactsRes] = await Promise.all([
          fetch(`/api/tenant/organizations/${s.orgId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`/api/tenant/organizations/${s.orgId}/groups`).then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
          fetch(`/api/tenant/organizations/${s.orgId}/contacts`).then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
        ]);
        if (cancelled) return;

        // Contacts have first_name + last_name; normalize to a display name for the picker
        const rawContacts = contactsRes?.contacts || [];
        const contacts = rawContacts.map((c) => ({ ...c, name: contactDisplayName(c) }));

        sections.push({
          source: s.source,
          label: s.label,
          orgId: s.orgId,
          orgName: orgRes?.organization?.name || 'Unknown',
          groups: groupsRes?.groups || [],
          contacts,
        });
      }
      if (!cancelled) {
        setOrgSections(sections);
        setLoadingSections(false);
      }
    }
    loadSections();
    return () => { cancelled = true; };
  }, [mode, customerId, pickupLocationOrgId, deliveryLocationOrgId, returnLocationOrgId]);

  // ── Search any organization (debounced) ──────────────────────
  // Org list endpoint uses ?search= (not ?q=)
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.trim();
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/tenant/organizations?search=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : { organizations: [] })).catch(() => ({ organizations: [] }));
      setSearchResults((res?.organizations || []).slice(0, 10));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  // ── Click-outside handler to close dropdown ──────────────────
  useEffect(() => {
    if (!pickerOpen) return;
    function handleOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pickerOpen]);

  // ── Close dropdown on scroll/resize (portal stays at fixed position) ──
  useEffect(() => {
    if (!pickerOpen) return;
    function close() { setPickerOpen(false); }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pickerOpen]);

  async function selectSearchOrg(org) {
    const [groupsRes, contactsRes] = await Promise.all([
      fetch(`/api/tenant/organizations/${org.id}/groups`).then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
      fetch(`/api/tenant/organizations/${org.id}/contacts`).then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
    ]);
    const rawContacts = contactsRes?.contacts || [];
    const contacts = rawContacts.map((c) => ({ ...c, name: contactDisplayName(c) }));
    setSearchSelected({ id: org.id, name: org.name, groups: groupsRes.groups || [], contacts });
  }

  // ── Add / remove handlers ────────────────────────────────────
  function isAlreadyAdded(party_type, party_id) {
    return (value || []).some((p) => p.party_type === party_type && p.party_id === party_id);
  }

  function addParty(section, party_type, partyObj) {
    if (isAlreadyAdded(party_type, partyObj.id)) return;
    const newEntry = {
      party_type,
      party_id: partyObj.id,
      source: section.source,
      source_organization_id: section.orgId,
      source_organization_name: section.orgName,
      name: partyObj.name,
      ...(party_type === 'group' ? { member_count: partyObj.member_count ?? null } : { email: partyObj.email }),
    };
    onChange([...(value || []), newEntry]);
    onManualEdit?.();
    setPickerOpen(false);
    setSearchQuery('');
    setSearchSelected(null);
  }

  function removeParty(idx) {
    const next = (value || []).filter((_, i) => i !== idx);
    onChange(next);
    onManualEdit?.();
  }

  // ── Group chips by source-org for display ────────────────────
  const chipsByOrg = useMemo(() => {
    const map = new Map();
    (value || []).forEach((p, idx) => {
      const key = `${p.source || 'other'}::${p.source_organization_id || ''}`;
      const label = p.source_organization_name || 'Other';
      const sourceLabel = ({
        customer: 'Customer',
        pickup_location: 'Pickup',
        delivery_location: 'Delivery',
        return_location: 'Return',
        other_org: 'Other',
        default: 'Customer',
      })[p.source] || 'Other';
      const heading = `${sourceLabel}: ${label}`;
      if (!map.has(key)) map.set(key, { heading, parties: [] });
      map.get(key).parties.push({ ...p, _idx: idx });
    });
    return Array.from(map.values());
  }, [value]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Chip groups */}
      {chipsByOrg.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-slate-400 italic">
          No notify parties for this {mode === 'load' ? 'load' : 'customer'}.
        </div>
      ) : (
        chipsByOrg.map((grp) => (
          <div key={grp.heading} className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
              {grp.heading}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {grp.parties.map((p) => {
                const isDead = p.name === null;
                return (
                  <span
                    key={p._idx}
                    className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs border ${
                      isDead
                        ? 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400 line-through'
                        : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300'
                    }`}
                  >
                    {p.party_type === 'group' ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {isDead ? `Deleted ${p.party_type}` : p.name}
                    {p.party_type === 'group' && !isDead && p.member_count != null && (
                      <span className="text-[10px] text-gray-500 dark:text-slate-500">
                        ({p.member_count})
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeParty(p._idx)}
                      className="hover:text-rose-600 dark:hover:text-rose-400 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      aria-label={`Remove ${p.name || 'party'}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Add button + dropdown */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setPickerOpen((o) => {
              const next = !o;
              if (next && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: 384 });
              }
              return next;
            });
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add notify party
        </button>

        {pickerOpen && dropdownPos && createPortal(
          <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, maxHeight: 480, zIndex: 200 }}
            className="overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg"
          >
            {loadingSections ? (
              <div className="p-3 text-xs text-gray-500 dark:text-slate-400">Loading…</div>
            ) : (
              <>
                {orgSections.map((section) => (
                  <div key={section.source} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-slate-400">
                      {section.label}: {section.orgName}
                    </div>
                    <div className="py-1">
                      {section.groups.length === 0 && section.contacts.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500 italic">
                          No groups or contacts
                        </div>
                      )}
                      {section.groups.map((g) => (
                        <button
                          key={`g-${g.id}`}
                          type="button"
                          onClick={() => addParty(section, 'group', g)}
                          disabled={isAlreadyAdded('group', g.id)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Users className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          <span className="flex-1">{g.name}</span>
                          {g.member_count != null && (
                            <span className="text-[10px] text-gray-500 dark:text-slate-500">
                              {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                            </span>
                          )}
                        </button>
                      ))}
                      {section.contacts.map((c) => (
                        <button
                          key={`c-${c.id}`}
                          type="button"
                          onClick={() => addParty(section, 'contact', c)}
                          disabled={isAlreadyAdded('contact', c.id)}
                          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          <span className="flex-1">
                            {c.name}
                            {c.email && <span className="ml-1 text-gray-400 dark:text-slate-500">{c.email}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Search any org */}
                <div className="border-t border-gray-200 dark:border-slate-700 p-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Search className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setSearchSelected(null); }}
                      placeholder="Search any organization…"
                      aria-label="Search organizations"
                      className="flex-1 text-xs bg-transparent border-none outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500"
                    />
                  </div>
                  {searchSelected ? (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 px-1">
                        Other: {searchSelected.name}
                      </div>
                      {searchSelected.groups.map((g) => (
                        <button
                          key={`sg-${g.id}`}
                          type="button"
                          onClick={() => addParty({ source: 'other_org', orgId: searchSelected.id, orgName: searchSelected.name }, 'group', g)}
                          disabled={isAlreadyAdded('group', g.id)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded disabled:opacity-40"
                        >
                          <Users className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          {g.name}
                          {g.member_count != null && (
                            <span className="ml-auto text-[10px] text-gray-500 dark:text-slate-500">
                              {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                            </span>
                          )}
                        </button>
                      ))}
                      {searchSelected.contacts.map((c) => (
                        <button
                          key={`sc-${c.id}`}
                          type="button"
                          onClick={() => addParty({ source: 'other_org', orgId: searchSelected.id, orgName: searchSelected.name }, 'contact', c)}
                          disabled={isAlreadyAdded('contact', c.id)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded disabled:opacity-40"
                        >
                          <User className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
                          <span className="flex-1">
                            {c.name}
                            {c.email && <span className="ml-1 text-gray-400 dark:text-slate-500">{c.email}</span>}
                          </span>
                        </button>
                      ))}
                      {searchSelected.groups.length === 0 && searchSelected.contacts.length === 0 && (
                        <div className="px-2 py-1 text-xs text-gray-400 dark:text-slate-500 italic">
                          No groups or contacts
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {searchQuery.trim() && searchResults.length === 0 ? (
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 italic px-2 py-1">
                          No organizations found
                        </div>
                      ) : (
                        searchResults.map((org) => (
                          <button
                            key={org.id}
                            type="button"
                            onClick={() => selectSearchOrg(org)}
                            className="block w-full px-2 py-1 text-xs text-left text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded"
                          >
                            {org.name}
                          </button>
                        ))
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
