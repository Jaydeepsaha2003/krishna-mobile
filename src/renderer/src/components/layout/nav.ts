import {
  ArrowLeftRight,
  BadgeIndianRupee,
  Boxes,
  ClipboardCheck,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Smartphone,
  Truck,
  Users
} from 'lucide-react'
import type { Permission } from '@shared/constants'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: Permission
  hotkey?: string
  group: 'Daily' | 'Records' | 'Insight' | 'Setup'
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, hotkey: 'alt+1', group: 'Daily', end: true },
  { to: '/sales/new', label: 'New Sale', icon: ShoppingCart, permission: 'sale.manage', hotkey: 'f2', group: 'Daily' },
  { to: '/sales', label: 'Sales', icon: Receipt, permission: 'sale.view', hotkey: 'alt+2', group: 'Daily', end: true },
  { to: '/credit', label: 'Credit & Dues', icon: BadgeIndianRupee, permission: 'sale.view', hotkey: 'alt+3', group: 'Daily' },
  { to: '/purchases', label: 'Purchases', icon: Truck, permission: 'purchase.view', hotkey: 'alt+4', group: 'Records' },
  { to: '/stock', label: 'Stock', icon: Boxes, permission: 'stock.view', hotkey: 'alt+5', group: 'Records' },
  { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, permission: 'transfer.view', hotkey: 'alt+6', group: 'Records' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customer.view', hotkey: 'alt+7', group: 'Records' },
  { to: '/suppliers', label: 'Suppliers', icon: Package, permission: 'supplier.view', group: 'Records' },
  { to: '/catalogue', label: 'Brands & Models', icon: Smartphone, permission: 'product.view', group: 'Records' },
  { to: '/reconciliation', label: 'Reconciliation', icon: ClipboardCheck, permission: 'reconciliation.view', hotkey: 'alt+8', group: 'Insight' },
  { to: '/reports', label: 'Reports', icon: BadgeIndianRupee, permission: 'report.view', hotkey: 'alt+9', group: 'Insight' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Setup' }
]

export const NAV_GROUPS: NavItem['group'][] = ['Daily', 'Records', 'Insight', 'Setup']
