/**
 * Email Variable Resolver
 *
 * Substitutes {{path.dotted}} tokens inside a template body with real
 * values formatted according to tenant_format_preferences (with optional
 * per-template overrides).
 *
 * ## Contract
 *
 *   const resolved = resolveTemplate({
 *     body: '<p>Container {{container.number}} has been delivered to {{delivery.name}}.</p>',
 *     context: { load, container, delivery, customer, tenant, user, ... },
 *     formatPrefs: tenantFormatPreferencesRow,
 *     templateOverrides: template.format_overrides || {},
 *     strict: false,
 *   });
 *
 *   => {
 *     html: '<p>Container MSCU1234567 has been delivered to ACME DC-Ontario.</p>',
 *     text: 'Container MSCU1234567 has been delivered to ACME DC-Ontario.',
 *     missing: [],                // paths that resolved to empty
 *     unknown: [],                // paths not in the catalog
 *     aborted: false,             // true if strict mode + missing required
 *   }
 *
 * ## Why a pure function?
 *
 * The resolver is called in three places:
 *   1. Trigger engine at send time (real send)
 *   2. Template editor live preview (sample data)
 *   3. Test send modal (test data)
 *
 * Keeping it pure and dependency-free lets all three reuse the same code
 * without any DB access — the caller is responsible for hydrating the
 * context object before handing it in.
 */

import {
  EMAIL_VARIABLES,
  EMAIL_VARIABLES_BY_PATH,
  findVariableReferences,
} from './email-variables.js';

// ──────────────────────────────────────────────────────────────
// Format preference defaults (mirror migration 051 defaults)
// ──────────────────────────────────────────────────────────────
export const FORMAT_DEFAULTS = {
  date_format: 'MM/DD/YYYY',
  date_use_long_month: false,
  date_empty_placeholder: '—',
  time_format: '12h',
  timezone: 'America/New_York',
  time_show_timezone: true,
  currency_code: 'USD',
  currency_symbol: '$',
  currency_position: 'prefix',
  currency_thousands: ',',
  currency_decimal: '.',
  currency_decimal_places: 2,
  currency_negative_style: 'minus',
  number_thousands: ',',
  number_decimal: '.',
  weight_unit: 'lbs',
  weight_decimal_places: 0,
  weight_show_unit: true,
  distance_unit: 'mi',
  phone_format: '(###) ###-####',
  phone_country_default: 'US',
  address_format: 'single_line',
  address_name_separator: ' — ',
  container_number_format: 'compact',
  empty_placeholder: '—',
  strict_empty_mode: false,
  organization_name_case: 'as_entered',
  location_name_case: 'as_entered',
  default_signature_html: null,
  default_signature_enabled: false,
};

/**
 * Merge application defaults ← tenant prefs ← template overrides
 * into a single effective format-prefs object.
 */
export function mergeFormatPrefs(tenantPrefs, templateOverrides) {
  return {
    ...FORMAT_DEFAULTS,
    ...(tenantPrefs || {}),
    ...(templateOverrides || {}),
  };
}

// ──────────────────────────────────────────────────────────────
// Value getter — walks a dotted path through the context object
// ──────────────────────────────────────────────────────────────
export function getByPath(obj, path) {
  if (obj == null || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ──────────────────────────────────────────────────────────────
// Formatters, one per `kind` in the variable catalog
// ──────────────────────────────────────────────────────────────

/** 'text' — basic string coercion with empty-placeholder fallback */
function formatText(value, prefs) {
  if (value == null || value === '') return prefs.empty_placeholder;
  return String(value);
}

/** 'number' — thousands + decimal separators */
function formatNumber(value, prefs, decimals = 0) {
  if (value == null || value === '') return prefs.empty_placeholder;
  const n = Number(value);
  if (!Number.isFinite(n)) return prefs.empty_placeholder;

  const fixed = n.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, prefs.number_thousands);
  return decPart ? `${withThousands}${prefs.number_decimal}${decPart}` : withThousands;
}

/** 'currency' */
function formatCurrency(value, prefs) {
  if (value == null || value === '') return prefs.empty_placeholder;
  // Callers must pass DOLLAR values (not cents). Our schema stores
  // currency as cents (integer), so context builders divide by 100
  // before placing values into the context. Passing raw cents here
  // silently renders a 100x-too-large amount.
  const n = Number(value);
  if (!Number.isFinite(n)) return prefs.empty_placeholder;

  const negative = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(prefs.currency_decimal_places);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, prefs.currency_thousands);
  const body = decPart
    ? `${withThousands}${prefs.currency_decimal}${decPart}`
    : withThousands;

  let rendered;
  if (prefs.currency_position === 'prefix') {
    rendered = `${prefs.currency_symbol}${body}`;
  } else if (prefs.currency_position === 'suffix') {
    rendered = `${body} ${prefs.currency_symbol}`;
  } else {
    // code_suffix
    rendered = `${body} ${prefs.currency_code}`;
  }

  if (!negative) return rendered;
  if (prefs.currency_negative_style === 'parens') return `(${rendered})`;
  if (prefs.currency_negative_style === 'red_minus')
    return `<span style="color:#dc2626">-${rendered}</span>`;
  return `-${rendered}`;
}

/** 'weight' — stored in lbs; converts to kg if tenant pref is metric */
function formatWeight(value, prefs) {
  if (value == null || value === '') return prefs.empty_placeholder;
  let n = Number(value);
  if (!Number.isFinite(n)) return prefs.empty_placeholder;

  if (prefs.weight_unit === 'kg') {
    n = n * 0.45359237;
  }
  const fmt = formatNumber(n, prefs, prefs.weight_decimal_places);
  return prefs.weight_show_unit ? `${fmt} ${prefs.weight_unit}` : fmt;
}

/** 'distance' — stored in miles; converts to km if tenant pref is metric */
function formatDistance(value, prefs) {
  if (value == null || value === '') return prefs.empty_placeholder;
  let n = Number(value);
  if (!Number.isFinite(n)) return prefs.empty_placeholder;

  if (prefs.distance_unit === 'km') {
    n = n * 1.609344;
  }
  return `${formatNumber(n, prefs, 0)} ${prefs.distance_unit}`;
}

/** 'date' — formats an ISO-like value into the tenant's date format */
function formatDate(value, prefs) {
  if (!value) return prefs.date_empty_placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return prefs.date_empty_placeholder;

  // Use Intl to respect the tenant timezone
  const tz = prefs.timezone || FORMAT_DEFAULTS.timezone;
  const longMonth = prefs.date_use_long_month;

  if (longMonth) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  }

  // Pull parts
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const m = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  const y = parts.find((p) => p.type === 'year')?.value || '';

  switch (prefs.date_format) {
    case 'DD/MM/YYYY':
      return `${day}/${m}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${day}`;
    case 'MMM D, YYYY':
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
      }).format(d);
    case 'D MMM YYYY':
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, day: 'numeric', month: 'short', year: 'numeric',
      }).format(d);
    case 'MM/DD/YYYY':
    default:
      return `${m}/${day}/${y}`;
  }
}

/** 'datetime' — date + time with timezone suffix if enabled */
function formatDateTime(value, prefs) {
  if (!value) return prefs.date_empty_placeholder;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return prefs.date_empty_placeholder;

  const tz = prefs.timezone || FORMAT_DEFAULTS.timezone;
  const datePart = formatDate(value, prefs);

  const timeOpts = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: prefs.time_format === '12h',
  };
  const timePart = new Intl.DateTimeFormat('en-US', timeOpts).format(d);

  let suffix = '';
  if (prefs.time_show_timezone) {
    const tzParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(d);
    const tzName = tzParts.find((p) => p.type === 'timeZoneName')?.value || '';
    if (tzName) suffix = ` ${tzName}`;
  }

  return `${datePart} at ${timePart}${suffix}`;
}

/** 'phone' — format per prefs.phone_format template */
function formatPhone(value, prefs) {
  if (!value) return prefs.empty_placeholder;
  // Strip non-digits
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return prefs.empty_placeholder;

  // US numbers — 10 digits
  if (digits.length === 10) {
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    switch (prefs.phone_format) {
      case '(###) ###-####':
        return `(${a}) ${b}-${c}`;
      case '###-###-####':
        return `${a}-${b}-${c}`;
      case '###.###.####':
        return `${a}.${b}.${c}`;
      case '+1 ### ### ####':
        return `+1 ${a} ${b} ${c}`;
      case 'raw':
        return digits;
      default:
        return `(${a}) ${b}-${c}`;
    }
  }

  // US 11 digits leading 1 — drop the country code then format
  if (digits.length === 11 && digits[0] === '1') {
    return formatPhone(digits.slice(1), prefs);
  }

  // Fallback — return the raw digits with the country code intact
  return digits;
}

/** 'email' — no transformation; just empty fallback */
function formatEmail(value, prefs) {
  if (!value) return prefs.empty_placeholder;
  return String(value);
}

/** 'url' — no transformation; just empty fallback */
function formatUrl(value, prefs) {
  if (!value) return prefs.empty_placeholder;
  return String(value);
}

/** 'address' — takes an object OR a string; composes using prefs */
function formatAddress(value, prefs) {
  if (value == null) return prefs.empty_placeholder;
  if (typeof value === 'string') return value;

  const line1 = value.line1 || value.address_line1 || value.street || '';
  const city = value.city || value.address_city || '';
  const state = value.state || value.address_state || '';
  const zip = value.zip || value.address_zip || value.postal || '';
  const name = value.name || '';

  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  if (prefs.address_format === 'multi_line') {
    return [line1, cityStateZip].filter(Boolean).join('\n');
  }
  if (prefs.address_format === 'company_first' && name) {
    return [name, line1, cityStateZip].filter(Boolean).join('\n');
  }
  return [line1, cityStateZip].filter(Boolean).join(', ');
}

/** 'container_number' — ISO format variations */
function formatContainerNumber(value, prefs) {
  if (!value) return prefs.empty_placeholder;
  const s = String(value).replace(/[\s-]/g, '').toUpperCase();
  if (s.length !== 11) return s; // return raw if not ISO-compliant length

  const owner = s.slice(0, 4);
  const serial = s.slice(4, 10);
  const check = s.slice(10);

  switch (prefs.container_number_format) {
    case 'grouped':
      return `${owner} ${serial}-${check}`;
    case 'spaced':
      return `${owner} ${serial} ${check}`;
    case 'compact':
    default:
      return s;
  }
}

// ──────────────────────────────────────────────────────────────
// Case helpers (for organization / location name casing)
// ──────────────────────────────────────────────────────────────
function applyCase(str, mode) {
  if (!str) return str;
  if (mode === 'upper') return String(str).toUpperCase();
  if (mode === 'title') {
    return String(str)
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return String(str);
}

// ──────────────────────────────────────────────────────────────
// Dispatch: pick the formatter based on the variable kind
// ──────────────────────────────────────────────────────────────
function formatValue(rawValue, variableMeta, prefs) {
  const kind = variableMeta?.kind || 'text';

  // Apply organization/location name casing BEFORE formatting, only for
  // the specific variables that represent org names.
  let value = rawValue;
  if (variableMeta) {
    if (variableMeta.path === 'customer.name' || variableMeta.path === 'customer.code') {
      value = applyCase(value, prefs.organization_name_case);
    } else if (
      variableMeta.path.endsWith('.name') &&
      ['pickup', 'delivery', 'return'].includes(variableMeta.category)
    ) {
      value = applyCase(value, prefs.location_name_case);
    }
  }

  switch (kind) {
    case 'date':
      return formatDate(value, prefs);
    case 'datetime':
      return formatDateTime(value, prefs);
    case 'currency':
      return formatCurrency(value, prefs);
    case 'number':
      return formatNumber(value, prefs, 0);
    case 'weight':
      return formatWeight(value, prefs);
    case 'distance':
      return formatDistance(value, prefs);
    case 'phone':
      return formatPhone(value, prefs);
    case 'email':
      return formatEmail(value, prefs);
    case 'url':
      return formatUrl(value, prefs);
    case 'address':
      return formatAddress(value, prefs);
    case 'container_number':
      return formatContainerNumber(value, prefs);
    case 'text':
    default:
      return formatText(value, prefs);
  }
}

// ──────────────────────────────────────────────────────────────
// Main entry — resolve a template body against a context
// ──────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.body - template HTML or text body with {{path}} tokens
 * @param {object} opts.context - hydrated data shape (load, container, customer, ...)
 * @param {object} [opts.formatPrefs] - tenant_format_preferences row
 * @param {object} [opts.templateOverrides] - per-template format_overrides JSONB
 * @param {boolean} [opts.strict] - abort (aborted=true) if any required var is empty
 * @returns {{ output: string, missing: string[], unknown: string[], aborted: boolean }}
 */
export function resolveTemplate({
  body,
  context,
  formatPrefs,
  templateOverrides,
  strict,
}) {
  const prefs = mergeFormatPrefs(formatPrefs, templateOverrides);
  if (typeof strict !== 'boolean') {
    strict = !!prefs.strict_empty_mode;
  }

  const missing = new Set();
  const unknown = new Set();
  let aborted = false;

  // Replace every {{path}} token with the formatted value
  const output = (body || '').replace(
    /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g,
    (match, path) => {
      const meta = EMAIL_VARIABLES_BY_PATH.get(path);
      if (!meta) {
        unknown.add(path);
        // Leave unknown references intact so the user notices them — makes
        // the failure visible rather than silently dropping content.
        return match;
      }

      const raw = getByPath(context, path);
      const isEmpty = raw == null || raw === '';
      if (isEmpty) {
        missing.add(path);
        if (strict && meta.required) {
          aborted = true;
        }
      }

      return formatValue(raw, meta, prefs);
    }
  );

  return {
    output,
    missing: Array.from(missing),
    unknown: Array.from(unknown),
    aborted,
  };
}

/**
 * Resolve both subject and body for a full template in one call.
 * Returns { subject, html, text, missing, unknown, aborted }.
 */
export function resolveEmailTemplate({
  subject,
  body_html,
  body_text,
  context,
  formatPrefs,
  templateOverrides,
  strict,
}) {
  const subjectResult = resolveTemplate({
    body: subject,
    context,
    formatPrefs,
    templateOverrides,
    strict,
  });
  const htmlResult = resolveTemplate({
    body: body_html,
    context,
    formatPrefs,
    templateOverrides,
    strict,
  });
  const textResult = body_text
    ? resolveTemplate({
        body: body_text,
        context,
        formatPrefs,
        templateOverrides,
        strict,
      })
    : { output: stripHtml(htmlResult.output), missing: [], unknown: [], aborted: false };

  const missing = Array.from(
    new Set([...subjectResult.missing, ...htmlResult.missing, ...textResult.missing])
  );
  const unknown = Array.from(
    new Set([...subjectResult.unknown, ...htmlResult.unknown, ...textResult.unknown])
  );
  const aborted = subjectResult.aborted || htmlResult.aborted || textResult.aborted;

  return {
    subject: subjectResult.output,
    html: htmlResult.output,
    text: textResult.output,
    missing,
    unknown,
    aborted,
  };
}

/**
 * Cheap HTML → plain text reducer for auto-generating body_text when the
 * template author didn't provide one. Not a full HTML parser — strips tags,
 * decodes common entities, collapses whitespace.
 */
export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ──────────────────────────────────────────────────────────────
// AR token families: invoice.* and charge_set.*
//
// These families are registered in the EMAIL_VARIABLES catalog
// (lib/email-variables.js) exactly like load.*, customer.*, driver.*,
// etc. The catalog-based dispatch in resolveTemplate already handles
// them — no per-family switch is needed here.
//
// Catalog paths and their context keys:
//   invoice.number          → context.invoice.number           (kind: text)
//   invoice.total           → context.invoice.total            (kind: currency, dollars)
//   invoice.subtotal        → context.invoice.subtotal         (kind: currency, dollars)
//   invoice.due_date        → context.invoice.due_date         (kind: date)
//   invoice.issue_date      → context.invoice.issue_date       (kind: date)
//   invoice.reference_number→ context.invoice.reference_number (kind: text, derived)
//   charge_set.number       → context.charge_set.number        (kind: text)
//   charge_set.total        → context.charge_set.total         (kind: currency, dollars)
//   charge_set.reference_number → context.charge_set.reference_number (kind: text)
//
// Contexts that include these families are built by:
//   buildInvoiceContext(svc, invoiceId, tenantId)
//   buildChargeSetContext(svc, chargeSetId, tenantId)
// both exported from lib/email-dispatch/index.js.
// ──────────────────────────────────────────────────────────────

/**
 * Build a sample context for the template editor live preview.
 * Pulls the `sample` field of every variable in the catalog so the preview
 * is visually realistic without needing a real load in the database.
 */
export function buildSampleContext() {
  // Pull samples from the catalog and arrange them into the same nested
  // shape the real resolver expects (load.*, container.*, customer.*, etc.)
  const ctx = {};
  for (const v of EMAIL_VARIABLES) {
    const parts = v.path.split('.');
    let cur = ctx;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v.sample ?? null;
  }
  return ctx;
}

/**
 * Compute the set of variable paths referenced by a full template.
 * Used by the trigger engine to know which subtree of the context
 * object needs hydrating from the database.
 */
export function collectReferencedPaths({ subject, body_html, body_text }) {
  const paths = new Set();
  for (const section of [subject, body_html, body_text]) {
    if (!section) continue;
    for (const ref of findVariableReferences(section)) {
      paths.add(ref.path);
    }
  }
  return Array.from(paths);
}
