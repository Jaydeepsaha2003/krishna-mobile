import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Download, Pencil, Phone, Plus, Search, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { formatPhone } from '@shared/validators'
import { Badge, Button, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'
import { SupplierFormDialog } from './SupplierFormDialog'

export function SuppliersPage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId } = useScope()
  const exportCsv = useCsvExport()

  const [search, setSearch] = React.useState('')
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search suppliers',
    group: 'Suppliers',
    allowInInputs: true
  })
  useHotkey('ctrl+n', () => {
    setEditing(null)
    setFormOpen(true)
  }, { description: 'New supplier', group: 'Suppliers', allowInInputs: true })

  const suppliers = useQuery({
    queryKey: ['suppliers-page', companyId, debounced],
    queryFn: () => api.suppliers.list({ search: debounced || undefined }),
    enabled: Boolean(companyId)
  })

  const rows = suppliers.data ?? []
  const payable = rows.reduce((a: number, r: any) => a + Number(r.payable || 0), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        description="Distributors and companies you buy stock from"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'suppliers',
                  rows.map((r: any) => ({
                    name: r.name,
                    contact: r.contactPerson ?? '',
                    phone: r.phone ?? '',
                    gstin: r.gstin ?? '',
                    city: r.city ?? '',
                    state: r.state ?? '',
                    bills: r.purchaseCount,
                    purchased: r.totalPurchased,
                    payable: r.payable
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
            {session.can('supplier.manage') && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus /> New supplier
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Suppliers" value={String(rows.length)} icon={Building2} tone="primary" />
        <StatCard
          label="Total purchased"
          value={money(rows.reduce((a: number, r: any) => a + Number(r.totalPurchased || 0), 0))}
          icon={Building2}
        />
        <StatCard
          label="Payable"
          value={money(payable)}
          icon={Wallet}
          tone={payable > 0 ? 'warning' : 'success'}
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, phone, GSTIN…"
          prefixNode={<Search />}
          className="w-80"
        />
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={suppliers.isLoading}
        empty="No suppliers yet"
        maxHeight="calc(100vh - 400px)"
        showFooter
        columns={[
          {
            key: 'name',
            header: 'Supplier',
            sortable: true,
            render: (r: any) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.contactPerson ? `${r.contactPerson} · ` : ''}
                  {formatPhone(r.phone) || '—'}
                </p>
              </div>
            ),
            footer: () => 'Total'
          },
          { key: 'supplierType', header: 'Type', hideBelow: 'lg', render: (r: any) => <Badge variant="secondary">{r.supplierType}</Badge> },
          { key: 'gstin', header: 'GSTIN', hideBelow: 'lg', render: (r: any) => <span className="font-mono text-xs">{r.gstin ?? '—'}</span> },
          {
            key: 'city',
            header: 'Place',
            hideBelow: 'md',
            render: (r: any) => [r.city, r.state].filter(Boolean).join(', ') || '—'
          },
          { key: 'purchaseCount', header: 'Bills', align: 'right', sortable: true },
          {
            key: 'totalPurchased',
            header: 'Purchased',
            align: 'right',
            sortable: true,
            render: (r: any) => <Money value={r.totalPurchased} />,
            footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.totalPurchased, 0)} />
          },
          {
            key: 'payable',
            header: 'Payable',
            align: 'right',
            sortable: true,
            render: (r: any) =>
              r.payable > 0.5 ? (
                <Money value={r.payable} className="font-semibold text-warning" />
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.payable, 0)} />
          },
          {
            key: 'lastPurchaseAt',
            header: 'Last bill',
            hideBelow: 'lg',
            render: (r: any) => (
              <span className="text-xs text-muted-foreground">{formatDate(r.lastPurchaseAt)}</span>
            )
          },
          {
            key: 'actions',
            header: '',
            width: '80px',
            render: (r: any) => (
              <div className="flex justify-end gap-1">
                {r.phone && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Call"
                    onClick={() => void api.app.openExternal(`tel:+91${r.phone}`)}
                  >
                    <Phone />
                  </Button>
                )}
                {session.can('supplier.manage') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => {
                      setEditing(r)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil />
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />

      <SupplierFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['suppliers-page'] })}
      />
    </div>
  )
}
