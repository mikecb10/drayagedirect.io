import {
  Building2,
  Users,
  Palette,
  Calculator,
  Ship,
  Box,
  Train,
  Truck,
  MapPin as MapPinIcon,
  ShieldCheck,
  Tag,
  DollarSign,
  Bell,
  CreditCard,
  MapPin,
  Type as TypeIcon,
  Mail,
  Umbrella,
  Zap,
  Globe,
  Activity,
  Inbox,
  GitBranch,
} from 'lucide-react';
import { PERMISSIONS } from './permissions';

/**
 * Settings navigation structure — single source of truth.
 *
 * Used by SettingsLayout (sidebar) and the settings index (overview).
 * Each group has a label + array of items. Each item maps to a page.
 */
export const SETTINGS_SECTIONS = [
  {
    group: 'General',
    items: [
      { key: 'company', label: 'Company Info', href: '/settings/company', icon: Building2 },
      { key: 'profile', label: 'My Account', href: '/settings/profile', icon: ShieldCheck },
    ],
  },
  {
    group: 'Pricing',
    items: [
      { key: 'charge_profiles', label: 'Charge Profiles', href: '/settings/charge-profiles', icon: DollarSign },
      { key: 'tariffs', label: 'Load Tariffs', href: '/settings/tariffs', icon: Tag },
      { key: 'per_diem', label: 'Per Diem Pricing', href: '/settings/per-diem', icon: Calculator },
    ],
  },
  {
    group: 'Operations',
    items: [
      { key: 'dispatcher_colors', label: 'Dispatcher Appearance', href: '/settings/dispatcher-colors', icon: Palette },
      { key: 'document_validation', label: 'Document Validation', href: '/settings/document-validation', icon: ShieldCheck },
    ],
  },
  {
    group: 'Equipment',
    items: [
      { key: 'container_owners', label: 'Container Owners', href: '/settings/container-owners', icon: Ship },
      { key: 'chassis_owners', label: 'Chassis Owners', href: '/settings/chassis-owners', icon: Truck },
      { key: 'equipment_reference', label: 'Equipment Reference', href: '/settings/equipment-reference', icon: Box },
      { key: 'terminal_markets', label: 'Terminal Markets', href: '/settings/terminal-markets', icon: Train },
      { key: 'terminals', label: 'Terminals', href: '/settings/terminals', icon: MapPinIcon },
    ],
  },
  {
    group: 'Team',
    items: [
      { key: 'branches', label: 'Branches', href: '/settings/branches', icon: GitBranch },
      { key: 'team', label: 'Team & Permissions', href: '/settings/team', icon: Users },
    ],
  },
  {
    group: 'Communications',
    items: [
      {
        key: 'comm_formatting',
        label: 'Formatting',
        href: '/settings/communications/formatting',
        icon: TypeIcon,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_templates',
        label: 'Email Templates',
        href: '/settings/communications/templates',
        icon: Mail,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_umbrellas',
        label: 'Umbrellas',
        href: '/settings/communications/umbrellas',
        icon: Umbrella,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_configurations',
        label: 'Configurations',
        href: '/settings/communications/configurations',
        icon: Zap,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_shared_accounts',
        label: 'Shared Accounts',
        href: '/settings/communications/shared-accounts',
        icon: Inbox,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_sender_domains',
        label: 'Sender Domains',
        href: '/settings/communications/sender-domains',
        icon: Globe,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_sender_addresses',
        label: 'Sender Addresses',
        href: '/settings/communications/sender-addresses',
        icon: Mail,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
      {
        key: 'comm_trigger_activity',
        label: 'Trigger Activity',
        href: '/settings/communications/trigger-activity',
        icon: Activity,
        requiredPermission: [PERMISSIONS.MANAGE_SYSTEM_EMAILS, PERMISSIONS.SETTINGS, PERMISSIONS.ALL],
      },
    ],
  },
  {
    group: 'Coming Soon',
    items: [
      { key: 'accessorials', label: 'Accessorials', href: '/coming-soon?feature=Accessorials', icon: Tag, comingSoon: true },
      { key: 'rates', label: 'Rate Profiles', href: '/coming-soon?feature=Rate+Profiles', icon: DollarSign, comingSoon: true },
      { key: 'locations', label: 'Locations', href: '/coming-soon?feature=Locations', icon: MapPin, comingSoon: true },
      { key: 'notifications', label: 'Notifications', href: '/coming-soon?feature=Notification+Rules', icon: Bell, comingSoon: true },
      { key: 'billing', label: 'Billing & Plan', href: '/coming-soon?feature=Billing', icon: CreditCard, comingSoon: true },
    ],
  },
];

// Flat list of all items for quick lookup
export const ALL_SETTINGS_ITEMS = SETTINGS_SECTIONS.flatMap((s) => s.items);

// Find which group a path belongs to
export function findGroupForPath(pathname) {
  for (const section of SETTINGS_SECTIONS) {
    for (const item of section.items) {
      if (item.href === pathname || pathname.startsWith(item.href + '/')) {
        return section.group;
      }
    }
  }
  return null;
}
