import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * DetailRow — single key/value row inside a DetailPane.
 *
 * Layout: label on the left (fixed-ish width, uppercase muted),
 * value on the right (body text, strong color). Padding uses
 * space-row. Supports two optional behaviors:
 *
 *   - copyable: shows a copy icon to the right of the value;
 *     click copies the value (must be string) to clipboard.
 *   - muted:    renders the value in muted color instead of strong
 *     (for empty/"—" placeholders).
 *
 * Usage:
 *   <DetailRow label="LFD" value="4/20" />
 *   <DetailRow label="Container" value="ABCD1234567" copyable />
 *   <DetailRow label="Chassis" value="—" muted />
 *   <DetailRow label="Status" value={<Badge>Pending</Badge>} />
 */
export default function DetailRow({
  label,
  value,
  copyable = false,
  muted = false,
  className = '',
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (typeof value !== 'string') return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — silent fail, no user-facing error
    }
  }

  const valueClass = muted ? 'text-muted' : 'text-strong';

  return (
    <div
      className={`flex items-baseline gap-[var(--space-inline)] py-[var(--space-row)] ${className}`}
    >
      <dt className="text-field-label text-muted shrink-0 w-40">{label}</dt>
      <dd className={`text-body ${valueClass} flex-1 min-w-0`}>{value}</dd>
      {copyable && typeof value === 'string' && (
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-muted hover:text-strong transition-colors"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
