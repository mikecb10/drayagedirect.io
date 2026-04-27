/**
 * HTML preview of Attached Documents. Mirrors components/pdf/sections/AttachedDocuments.js.
 * Accent-banded header + 2-column table. `opts` unused — master-toggle only.
 */
export default function AttachedDocumentsPreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Attached Documents
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">File Name</th>
            <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={2} className="text-center italic text-gray-500 py-3">
                (No attached documents)
              </td>
            </tr>
          ) : (
            data.map((doc, idx) => (
              <tr key={doc.id || idx} className="border-b border-gray-100">
                <td className="px-2 py-1.5">{doc.file_name || '—'}</td>
                <td className="px-2 py-1.5">{doc.uploaded_at || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
