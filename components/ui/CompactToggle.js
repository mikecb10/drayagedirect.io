import { Monitor, Minimize2 } from 'lucide-react';
import { useCompactMode } from '../../contexts/CompactModeContext';

/**
 * CompactToggle — small button for the TopBar that switches between
 * comfortable (default) and compact view modes.
 */
export default function CompactToggle() {
  const { isCompact, toggleCompact } = useCompactMode();

  return (
    <button
      type="button"
      onClick={toggleCompact}
      title={isCompact ? 'Switch to comfortable view' : 'Switch to compact view'}
      className={`p-2 rounded-lg transition-colors ${
        isCompact
          ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      }`}
    >
      {isCompact ? (
        <Minimize2 className="w-4 h-4" />
      ) : (
        <Monitor className="w-4 h-4" />
      )}
    </button>
  );
}
