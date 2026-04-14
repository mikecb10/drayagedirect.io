/**
 * FieldGroup — responsive grid layout for a set of Fields inside a SectionCard.
 *
 * Owns:
 *   - Grid columns (1, 2, 3, or 4 — responsive)
 *   - gap-[var(--space-field)] between fields
 *
 * Does NOT own label/input markup — that's Field's job. Compose them:
 *
 *   <SectionCard title="Container" columns={0}>
 *     <FieldGroup columns={2}>
 *       <Field label="Container Number" required>
 *         <Input ... />
 *       </Field>
 *       <Field label="Seal" helper="Optional">
 *         <Input ... />
 *       </Field>
 *     </FieldGroup>
 *   </SectionCard>
 *
 * Pass columns={1} for full-width stacked fields.
 */
export default function FieldGroup({ columns = 2, className = '', children }) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[columns] || 'grid-cols-1 sm:grid-cols-2';

  return (
    <div className={`grid ${gridCols} gap-[var(--space-field)] ${className}`}>
      {children}
    </div>
  );
}
