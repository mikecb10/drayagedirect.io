import Link from 'next/link';
import { Menu, Settings as SettingsIcon } from 'lucide-react';
import TopBarSearch from './TopBarSearch';
import QuickAddDropdown from './QuickAddDropdown';
import MessagesDropdown from './MessagesDropdown';
import NotificationsDropdown from './NotificationsDropdown';
import ProfileDropdown from './ProfileDropdown';
import CompactToggle from '../ui/CompactToggle';
import ThemeToggle from '../ui/ThemeToggle';

export default function TopBar({ title, onOpenMobileSidebar }) {
  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 h-16 flex items-center gap-3 px-4 lg:px-6">
      {/* Mobile sidebar toggle */}
      <button
        onClick={onOpenMobileSidebar}
        className="lg:hidden text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
        aria-label="Open menu"
      >
        <Menu className="w-6 h-6" strokeWidth={1.75} />
      </button>

      {/* Page title (hidden on small screens to make room for search) */}
      {title && (
        <h1 className="hidden xl:block text-lg font-semibold text-gray-900 dark:text-slate-100 shrink-0 mr-2">
          {title}
        </h1>
      )}

      {/* Search */}
      <TopBarSearch />

      {/* Right cluster */}
      <div className="flex items-center gap-1 ml-auto">
        <QuickAddDropdown />
        <MessagesDropdown />
        <NotificationsDropdown />
        <ThemeToggle />
        <CompactToggle />
        <Link
          href="/settings"
          title="Settings"
          className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100 transition-colors"
        >
          <SettingsIcon className="w-5 h-5" strokeWidth={1.75} />
        </Link>
        <div className="w-px h-6 bg-gray-200 dark:bg-slate-700 mx-1" />
        <ProfileDropdown />
      </div>
    </header>
  );
}
