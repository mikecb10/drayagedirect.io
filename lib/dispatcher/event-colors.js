/**
 * Event-type → color and label maps. Used by the planner cards (MoveCell,
 * MoveCardExpanded Route section) to render event badges and route-step dots.
 *
 * Tailwind class strings — usable directly on JSX className.
 */
export const EVENT_COLOR = {
  pickup:  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  deliver: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  return:  'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

export const EVENT_LABEL = {
  pickup:  'Pick Up Container',
  deliver: 'Deliver Container',
  return:  'Return Container',
};

/**
 * Compact dot color (just text-color, no bg) for route-step dots in the
 * MoveCardExpanded Route section.
 */
export const EVENT_DOT_COLOR = {
  pickup:  'text-blue-500 dark:text-blue-400',
  deliver: 'text-green-500 dark:text-green-400',
  return:  'text-purple-500 dark:text-purple-400',
};
