import { Sun, Moon, SunMoon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * ThemeToggle — sun/moon/sun-moon icon button that cycles through
 * light → dark → system → light theme states. Lives in TopBar next
 * to the CompactToggle.
 *
 * The icon shown reflects the CURRENT state, and the tooltip hints
 * at what clicking will do next:
 *   ☀  Sun     "Theme: Light · Click for Dark"
 *   🌙 Moon    "Theme: Dark · Click for System"
 *   ☀🌙 SunMoon "Theme: System · Click for Light"
 *
 * SunMoon (instead of Monitor) is used for system mode because the
 * CompactToggle next to it already uses Monitor for "comfortable view"
 * — two monitors side-by-side meaning different things would be
 * confusing. SunMoon is also the more universally recognized "auto
 * theme" icon.
 */
export default function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();

  const config = {
    light: { Icon: Sun, label: 'Light', next: 'Dark' },
    dark: { Icon: Moon, label: 'Dark', next: 'System' },
    system: { Icon: SunMoon, label: 'System', next: 'Light' },
  }[theme] || { Icon: Sun, label: 'Light', next: 'Dark' };

  const { Icon } = config;

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={`Theme: ${config.label} · Click for ${config.next}`}
      aria-label={`Switch theme. Currently ${config.label}. Click to switch to ${config.next}.`}
      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
    >
      <Icon className="w-5 h-5" strokeWidth={1.75} />
    </button>
  );
}
