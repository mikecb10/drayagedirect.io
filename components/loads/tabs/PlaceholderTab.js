import { Construction } from 'lucide-react';

/**
 * Generic empty state for Load Detail tabs not yet implemented in 5b-1.
 */
export default function PlaceholderTab({ title, description, icon: Icon = Construction }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-blue-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
      {description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">{description}</p>}
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-4">Coming in Phase 5b-2</p>
    </div>
  );
}
