/**
 * Field — single labeled form field cell.
 *
 * Renders:
 *   - Label (uppercase, muted, tracking per text-field-label utility)
 *   - Required asterisk (red-500)
 *   - Input (passed as children)
 *   - Helper text OR error text below the input
 *
 * Consumers pass any input/select/textarea/custom control as children.
 * The label sits above with space-field-label gap; helper/error sits
 * below with a tight 2px gap.
 *
 * Usage:
 *   <Field label="Container Number" required>
 *     <Input value={...} onChange={...} />
 *   </Field>
 *   <Field label="Seal" helper="Optional — 8 digits">
 *     <Input ... />
 *   </Field>
 *   <Field label="Zip" error="Must be 5 digits">
 *     <Input ... />
 *   </Field>
 */
export default function Field({
  label,
  required = false,
  helper,
  error,
  className = '',
  children,
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-field-label text-muted mb-[var(--space-field-label)]">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-helper text-red-600 dark:text-red-400 mt-0.5">{error}</p>
      ) : helper ? (
        <p className="text-helper text-muted mt-0.5">{helper}</p>
      ) : null}
    </div>
  );
}
