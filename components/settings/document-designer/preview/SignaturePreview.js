/**
 * HTML preview of the Signature Block. Renders Print Name / Receiver
 * Signature / Time In / Time Out / Date as labeled signature lines at the
 * bottom of the document.
 *
 * No `opts.fields` — Signature is a master-toggle-only section in the registry
 * (children deferred to FU-035-D2).
 */
export default function SignaturePreview({ data }) {
  if (!data) return null;
  return (
    <div className="mt-6 pt-4 border-t border-gray-300">
      <div className="grid grid-cols-3 gap-6">
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.print_name || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Print Name</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.signature || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Receiver Signature</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.date || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Date</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.time_in || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Time In</div>
        </div>
        <div>
          <div className="border-b border-gray-400 h-6 flex items-end pb-1">
            <span className="text-[11px] text-gray-900">{data.time_out || ''}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">Time Out</div>
        </div>
      </div>
    </div>
  );
}
