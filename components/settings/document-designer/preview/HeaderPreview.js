/**
 * HTML preview of the Header section. Mirrors components/pdf/sections/Header.js
 * but renders to plain HTML for the live preview pane in the Document Designer.
 *
 * Two-column layout: left = tenant identity (logo / company name / address /
 * phone / website); right = document title in the accent-colored band, with
 * an optional subtitle (document number) muted below.
 *
 * `data.tenantName` and `data.tenantInfo.logo_url` may be overridden by the
 * page's real `branding` payload (from /api/tenant/me). When present in
 * `data` they take priority over the sample-data defaults.
 *
 * `data.title` (e.g., "CREDIT MEMO", "STATEMENT", "INVOICE") is supplied
 * per-doc-type via `lib/document-designer/sample-data-*.js`. When absent,
 * the preview falls back to a generic "Document" label rather than leaking
 * a stale "Delivery Order" placeholder onto every doc type's preview
 * (FU-035-H6-followup-G).
 *
 * `data.subtitle` (e.g., "CM-2026-014", "OF ACCOUNT") renders muted below
 * the badge — matches the PDF Header's title-then-subtitle stacking.
 *
 * `opts.fields`: { logo, address, phone, website, company_name }.
 * Default-true except `website` (matches registry).
 *
 * `colors.accent`: hex color for the right-side document-title band.
 * `colors.text`:   hex color for body text.
 */
export default function HeaderPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const textColor = colors?.text || '#111827';
  const showLogo        = fields.logo        !== false;
  const showAddress     = fields.address     !== false;
  const showPhone       = fields.phone       !== false;
  const showWebsite     = fields.website === true;
  const showCompanyName = fields.company_name !== false;

  const logoUrl = data.tenantInfo?.logo_url;
  const address = data.tenantInfo?.address;
  const phone   = data.tenantInfo?.phone;
  const website = data.tenantInfo?.website;

  return (
    <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-200">
      <div className="flex gap-3 items-start">
        {showLogo ? (
          logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="w-16 h-16 object-contain" />
          ) : (
            <div className="w-16 h-16 rounded border border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-400">
              Logo
            </div>
          )
        ) : null}
        <div>
          {showCompanyName ? (
            <div className="text-base font-semibold" style={{ color: textColor }}>
              {data.tenantName || 'Company'}
            </div>
          ) : null}
          {showAddress && address ? (
            <div className="text-xs text-gray-600 mt-0.5">{address}</div>
          ) : null}
          {showPhone && phone ? (
            <div className="text-xs text-gray-600">{phone}</div>
          ) : null}
          {showWebsite && website ? (
            <div className="text-xs text-gray-600">{website}</div>
          ) : null}
        </div>
      </div>
      <div className="text-right">
        <div
          className="inline-block px-3 py-1.5 text-white rounded text-xs font-semibold"
          style={{ backgroundColor: accent }}
        >
          {data.title || 'Document'}
        </div>
        {data.subtitle ? (
          <div className="text-xs text-gray-600 mt-1">{data.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
