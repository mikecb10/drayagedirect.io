import addrs from 'email-addresses';

/**
 * Parse a free-text Reply-To input into structured {email, name}.
 *
 * Accepts:
 *   - `"Acme Trucking" <acme@acme.com>`  → { name: 'Acme Trucking', email: 'acme@acme.com' }
 *   - `Acme Trucking <acme@acme.com>`     → { name: 'Acme Trucking', email: 'acme@acme.com' }
 *   - `acme@acme.com`                      → { name: null, email: 'acme@acme.com' }
 *   - empty / whitespace / null            → { name: null, email: null } (= "no reply-to")
 *
 * Rejects:
 *   - name-only ("Acme Trucking")
 *   - unclosed quotes/angles
 *   - anything that isn't a valid mailbox address
 *
 * @param input string | null
 * @returns { ok: true, email: string|null, name: string|null } | { ok: false, error: string }
 */
export function parseReplyTo(input) {
  if (input == null) return { ok: true, email: null, name: null };
  const trimmed = String(input).trim();
  if (trimmed === '') return { ok: true, email: null, name: null };

  const parsed = addrs.parseOneAddress(trimmed);
  if (!parsed || !parsed.address) {
    return {
      ok: false,
      error: 'Please use the format: "Your Company" <you@yourdomain.com>',
    };
  }

  return {
    ok: true,
    email: parsed.address,
    name: parsed.name || null,
  };
}
