import { useEffect, useState } from 'react';
import { Truck, Receipt, Warehouse, ClipboardList, Ship, Trash2, Send, Pencil, Check, X } from 'lucide-react';
import Alert from '../../ui/Alert';

const AUDIENCES = [
  {
    key: 'driver',
    label: 'Driver',
    description: 'Notes for the driver — appears on the mobile app',
    icon: Truck,
    color: 'blue',
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Notes for the billing team / AR',
    icon: Receipt,
    color: 'emerald',
  },
  {
    key: 'yard',
    label: 'Yard',
    description: 'Notes for the yard crew',
    icon: Warehouse,
    color: 'amber',
  },
  {
    key: 'load',
    label: 'Load (Office)',
    description: 'Internal office notes for this load',
    icon: ClipboardList,
    color: 'purple',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    description: 'Notes related to the terminal / port / rail',
    icon: Ship,
    color: 'slate',
  },
];

const COLOR_STYLES = {
  blue: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
  amber: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200',
  purple: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200',
  slate: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100',
};

const ICON_COLORS = {
  blue: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40',
  emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40',
  amber: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40',
  purple: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/40',
  slate: 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800',
};

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

export default function NotesTab({ load }) {
  const [notesByAudience, setNotesByAudience] = useState({
    driver: [], billing: [], yard: [], load: [], terminal: [],
  });
  const [drafts, setDrafts] = useState({
    driver: '', billing: '', yard: '', load: '', terminal: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');

  async function loadNotes() {
    if (!load?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/notes`);
      if (!res.ok) throw new Error('Failed to load notes');
      const data = await res.json();
      const grouped = { driver: [], billing: [], yard: [], load: [], terminal: [] };
      for (const n of data.notes || []) {
        if (grouped[n.audience]) grouped[n.audience].push(n);
      }
      setNotesByAudience(grouped);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load?.id]);

  async function handleSubmit(audience) {
    const body = drafts[audience]?.trim();
    if (!body) return;
    setPosting(audience);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, body }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to post note');
      }
      setDrafts((d) => ({ ...d, [audience]: '' }));
      await loadNotes();
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(null);
    }
  }

  async function handleDelete(noteId) {
    if (!confirm('Delete this note?')) return;
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/notes/${noteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete note');
      await loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleEdit(noteId) {
    if (!editBody.trim()) return;
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editBody }),
      });
      if (!res.ok) throw new Error('Failed to update note');
      setEditingId(null);
      setEditBody('');
      await loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {AUDIENCES.map((aud) => {
        const Icon = aud.icon;
        const notes = notesByAudience[aud.key] || [];
        return (
          <section key={aud.key} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/70 rounded-t-xl">
              <div className={`rounded-lg p-2 ${ICON_COLORS[aud.color]}`}>
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{aud.label}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{aud.description}</div>
              </div>
              <span className="text-xs text-gray-400 dark:text-slate-500">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
            </div>

            {/* Existing notes */}
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {loading ? (
                <div className="px-4 py-4 text-xs text-gray-400 dark:text-slate-500">Loading...</div>
              ) : notes.length === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-400 dark:text-slate-500 italic">No notes yet</div>
              ) : (
                notes.map((n) => {
                  const authorName = n.author?.name || n.author?.email || 'Unknown';
                  const authorInitial = (authorName[0] || '?').toUpperCase();
                  const isEditing = editingId === n.id;

                  return (
                    <div key={n.id} className={`px-4 py-3 border-l-4 ${COLOR_STYLES[aud.color]}`}>
                      {isEditing ? (
                        /* Edit mode */
                        <div className="space-y-2">
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={3}
                            autoFocus
                            className="block w-full rounded-lg border border-blue-300 dark:border-blue-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 resize-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                handleEdit(n.id);
                              }
                              if (e.key === 'Escape') {
                                setEditingId(null);
                                setEditBody('');
                              }
                            }}
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => { setEditingId(null); setEditBody(''); }}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                              <X className="w-3 h-3" /> Cancel
                            </button>
                            <button
                              onClick={() => handleEdit(n.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              <Check className="w-3 h-3" /> Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Display mode */
                        <>
                          <div className="flex items-start gap-3">
                            <p className="text-sm text-gray-800 dark:text-slate-100 whitespace-pre-wrap flex-1">{n.body}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => { setEditingId(n.id); setEditBody(n.body); }}
                                className="text-gray-300 dark:text-slate-600 hover:text-blue-500 transition-colors"
                                title="Edit note"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(n.id)}
                                className="text-gray-300 dark:text-slate-600 hover:text-red-500 transition-colors"
                                title="Delete note"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {/* Author + timestamp */}
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {authorInitial}
                            </div>
                            <span className="text-[11px] font-medium text-gray-600 dark:text-slate-300">{authorName}</span>
                            <span className="text-[11px] text-gray-400 dark:text-slate-500">·</span>
                            <span className="text-[11px] text-gray-400 dark:text-slate-500">{formatDate(n.created_at)}</span>
                            {n.updated_at && n.updated_at !== n.created_at && (
                              <span className="text-[10px] text-gray-400 dark:text-slate-500 italic">(edited)</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Compose */}
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 rounded-b-xl">
              <div className="flex gap-2">
                <textarea
                  value={drafts[aud.key]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [aud.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSubmit(aud.key);
                    }
                  }}
                  placeholder={`Add a note for ${aud.label.toLowerCase()}... (Ctrl+Enter to post)`}
                  rows={2}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 resize-none"
                />
                <button
                  type="button"
                  onClick={() => handleSubmit(aud.key)}
                  disabled={!drafts[aud.key]?.trim() || posting === aud.key}
                  className="self-end rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white px-4 py-2 text-sm font-medium transition-colors"
                >
                  <Send className="w-4 h-4 inline -mt-0.5" />
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
