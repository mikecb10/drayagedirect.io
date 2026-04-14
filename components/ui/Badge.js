export default function Badge({ variant = 'gray', children }) {
  const styles = {
    green: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-400/30',
    red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/30',
    yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20 dark:bg-yellow-950/40 dark:text-yellow-300 dark:ring-yellow-400/30',
    blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/30',
    gray: 'bg-gray-50 text-gray-600 ring-gray-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-500/30',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        styles[variant] || styles.gray
      }`}
    >
      {children}
    </span>
  );
}
