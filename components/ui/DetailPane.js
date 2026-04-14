/**
 * DetailPane — read-only key/value list with dividers.
 *
 * Renders a vertical stack of DetailRows. Each row separated by a
 * bottom border except the last. Use inside a SectionCard or as a
 * top-level block.
 *
 * Usage:
 *   <DetailPane>
 *     <DetailRow label="Container #" value="ABCD1234567" copyable />
 *     <DetailRow label="Discharge"   value="4/15 14:30" />
 *     <DetailRow label="LFD"         value={<Badge>4/20</Badge>} />
 *     <DetailRow label="Chassis"     value="—" muted />
 *   </DetailPane>
 */
export default function DetailPane({ className = '', children }) {
  return (
    <dl className={`divide-y divide-gray-100 dark:divide-slate-800 ${className}`}>
      {children}
    </dl>
  );
}
