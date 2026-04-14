import {
  LayoutDashboard,
  MapPin,
  LayoutGrid,
  Building2,
  Users,
  Truck,
  FileCheck,
  Receipt,
  Wallet,
  BarChart3,
  Settings,
} from 'lucide-react';
import { PERMISSIONS } from './permissions';

/**
 * Main sidebar navigation — modeled after PortPro's module structure.
 * Each item may declare a requiredPermission that hides it from users
 * without access. comingSoon routes to the stub page and renders with
 * a greyed-out "Soon" badge.
 *
 * Phase 4 ships Dashboard + Settings as real. Everything else is a
 * placeholder that routes to /coming-soon until Phase 5.
 */
export const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    href: '/coming-soon?feature=Tracking',
    label: 'Tracking',
    icon: MapPin,
    requiredPermission: [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
    comingSoon: true,
  },
  {
    href: '/dispatcher',
    label: 'Dispatcher',
    icon: LayoutGrid,
    requiredPermission: [
      PERMISSIONS.ORDER_ENTRY,
      PERMISSIONS.DISPATCHING,
      PERMISSIONS.ALL,
    ],
  },
  {
    href: '/organizations',
    label: 'Organizations',
    icon: Building2,
    requiredPermission: [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
  },
  {
    href: '/drivers',
    label: 'Drivers',
    icon: Users,
    requiredPermission: [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
  },
  {
    href: '/equipment',
    label: 'Equipment',
    icon: Truck,
    requiredPermission: [PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
  },
  {
    href: '/documents',
    label: 'Documents',
    icon: FileCheck,
    requiredPermission: [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ALL],
    badgeEndpoint: '/api/tenant/document-submissions/count', // sidebar fetches this for the badge
  },
  {
    href: '/ar',
    label: 'Accounts Receivable',
    icon: Receipt,
    requiredPermission: [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
  },
  {
    href: '/ap',
    label: 'Accounts Payable',
    icon: Wallet,
    requiredPermission: [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL],
  },
  {
    href: '/coming-soon?feature=Reports',
    label: 'Reports',
    icon: BarChart3,
    requiredPermission: [PERMISSIONS.REPORTING, PERMISSIONS.ALL],
    comingSoon: true,
  },
];

export const SETTINGS_NAV = {
  href: '/settings',
  label: 'Settings',
  icon: Settings,
};
