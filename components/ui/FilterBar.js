import { Search, X } from 'lucide-react';

/**
 * Standard filter bar above data tables.
 * Provides a search input and a slot for extra filters + actions.
 *
 * Usage:
 *   <FilterBar
 *     search={search}
 *     onSearchChange={setSearch}
 *     placeholder="Search organizations..."
 *   >
 *     <Select ... />    // custom filter dropdowns as children
 *     <Button>Add New</Button>
 *   </FilterBar>
 */
export default function FilterBar({
  search = '',
  onSearchChange,
  placeholder = 'Search...',
  children,
  className = '',
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder={placeholder}
          className="w-full h-10 pl-9 pr-9 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange?.('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
