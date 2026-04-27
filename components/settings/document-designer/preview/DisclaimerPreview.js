/**
 * HTML preview of the Disclaimer section. Renders italicized footer text.
 * The actual rich-text editor for the content is FU-035-G.
 *
 * No `opts.fields` — master-toggle-only.
 */
export default function DisclaimerPreview({ data }) {
  if (!data || !data.text) return null;
  return (
    <div className="mt-4 pt-3 border-t border-gray-200">
      <div className="text-[10px] italic text-gray-600 leading-relaxed">{data.text}</div>
    </div>
  );
}
