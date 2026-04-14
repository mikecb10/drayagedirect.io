export default function Logo({ size = 'default', className = '' }) {
  const sizes = {
    small: { d: 'text-2xl', text: 'text-lg' },
    default: { d: 'text-4xl', text: 'text-2xl' },
    large: { d: 'text-5xl', text: 'text-3xl' },
  };

  const s = sizes[size] || sizes.default;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <span className={`${s.d} font-bold text-blue-500 dark:text-blue-400`}>D</span>
      <div className="flex flex-col leading-tight">
        <span className={`${s.text} font-semibold text-gray-900 dark:text-slate-100 leading-none`}>
          Drayage
        </span>
        <span className={`${s.text} font-semibold text-gray-900 dark:text-slate-100 leading-none`}>
          Direct
        </span>
      </div>
    </div>
  );
}
