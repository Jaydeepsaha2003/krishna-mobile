import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Building2,
  ClipboardList,
  Database,
  Download,
  HandCoins,
  Info,
  KeyRound,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Unlock,
  Users,
  Wrench
} from 'lucide-react'
import { api } from '@/lib/api'
import { useDateRange, useReconReasons, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useTheme } from '@/lib/theme'
import { formatDateTime, initials, money, relativeTime } from '@/lib/utils'
import { ALL_PERMISSIONS, FEATURES, PERMISSIONS, ROLE_LABELS, SETTING_DEFAULT_PENALTY, type Permission } from '@shared/constants'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Separator } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { Checkbox, SimpleSelect, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/form'
import { MultiCombobox } from '@/components/ui/combobox'
import { DateRangePicker, EmptyState, PageHeader, PinInput } from '@/components/ui/misc'
import { ChangePinDialog } from '@/components/layout/ChangePinDialog'
import { CompanyFormDialog, ShopFormDialog } from './OrgDialogs'
import { ImportAccessTab } from './ImportAccessTab'
import { ServicesTab } from './ServicesTab'

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const session = useSession()
  const tab = params.get('tab') ?? 'profile'
  const setTab = (t: string) => setParams({ tab: t }, { replace: true })

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Users, companies, shops and everything behind the scenes" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">
            <ShieldCheck /> My account
          </TabsTrigger>
          {session.can('user.view') && (
            <TabsTrigger value="users">
              <Users /> Users
            </TabsTrigger>
          )}
          {session.can('company.view') && (
            <TabsTrigger value="org">
              <Building2 /> Companies & shops
            </TabsTrigger>
          )}
          {session.can('reconciliation.view') && (
            <TabsTrigger value="reasons">
              <ListChecks /> Reasons
            </TabsTrigger>
          )}
          {session.can('product.manage') && (
            <TabsTrigger value="services">
              <Wrench /> Services
            </TabsTrigger>
          )}
          {FEATURES.emiLoans && session.can('loan.manage') && (
            <TabsTrigger value="loans">
              <HandCoins /> EMI loans
            </TabsTrigger>
          )}
          {session.can('audit.view') && (
            <TabsTrigger value="audit">
              <ClipboardList /> Audit trail
            </TabsTrigger>
          )}
          {FEATURES.dataImport && session.can('settings.manage') && (
            <TabsTrigger value="import">
              <Database /> Import data
            </TabsTrigger>
          )}
          <TabsTrigger value="about">
            <Info /> About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="org">
          <OrgTab />
        </TabsContent>
        <TabsContent value="reasons">
          <ReasonsTab />
        </TabsContent>
        <TabsContent value="services">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="loans">
          <LoanSettingsTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
        <TabsContent value="import">
          <ImportAccessTab />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ========================================================================== */
/*  My account                                                                */
/* ========================================================================== */

function ProfileTab() {
  const session = useSession()
  const theme = useTheme()
  const [pinOpen, setPinOpen] = React.useState(false)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Signed in as</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className="flex size-12 items-center justify-center rounded-xl text-base font-semibold text-white"
              style={{ background: session.user?.avatarColor ?? '#4f46e5' }}
            >
              {initials(session.user?.name)}
            </span>
            <div>
              <p className="font-medium">{session.user?.name}</p>
              <p className="text-[13px] text-muted-foreground">
                {session.user?.username} · {ROLE_LABELS[session.user?.role as never] ?? session.user?.role}
              </p>
            </div>
          </div>

          <Separator />

          <Button variant="outline" onClick={() => setPinOpen(true)}>
            <KeyRound /> Change my 6-digit PIN
          </Button>

          <p className="text-xs text-muted-foreground">
            The PIN is asked every time the app opens — there is no “stay signed in”. Five wrong
            attempts lock the account for five minutes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>The setting is remembered on this computer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Theme">
            <SimpleSelect
              value={theme.mode}
              onChange={(v) => theme.setMode(v as any)}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'Match Windows' }
              ]}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Shortcut: <span className="kbd">Ctrl</span> <span className="kbd">Shift</span>{' '}
            <span className="kbd">T</span>
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
          <CardDescription>
            Permissions granted by your role. An administrator can change these.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {ALL_PERMISSIONS.filter((p) => session.can(p)).map((p) => (
            <Badge key={p} variant="secondary">
              {PERMISSIONS[p]}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <ChangePinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </div>
  )
}

/* ========================================================================== */
/*  Users                                                                     */
/* ========================================================================== */

const EMPTY_USER = {
  name: '',
  username: '',
  phone: '',
  email: '',
  role: 'cashier',
  permissions: [] as Permission[],
  companyIds: [] as string[],
  shopIds: [] as string[],
  isActive: true,
  mustChangePin: true
}

function UsersTab() {
  const qc = useQueryClient()
  const session = useSession()

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.users.list() })
  const companies = useQuery({ queryKey: ['companies-all'], queryFn: () => api.companies.list(true) })
  const shops = useQuery({ queryKey: ['shops-all'], queryFn: () => api.shops.list(undefined, true) })

  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(EMPTY_USER)
  const [pin, setPin] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [resetFor, setResetFor] = React.useState<any>(null)
  const [resetPin, setResetPin] = React.useState('')

  const openNew = () => {
    setDraft({ ...EMPTY_USER })
    setPin('')
    setOpen(true)
  }

  const openEdit = (u: any) => {
    setDraft({
      id: u.id,
      name: u.name,
      username: u.username,
      phone: u.phone ?? '',
      email: u.email ?? '',
      role: u.role,
      permissions: u.permissions ?? [],
      companyIds: u.companyIds,
      shopIds: u.shopIds,
      isActive: u.isActive,
      mustChangePin: u.mustChangePin
    })
    setPin('')
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.users.save({ ...draft, pin: pin || undefined })
      toast.success(draft.id ? 'User updated' : 'User created')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resetPinNow = async () => {
    try {
      await api.users.setPin(resetFor.id, resetPin, true)
      toast.success(`PIN reset for ${resetFor.name} — they must change it at next login`)
      setResetFor(null)
      setResetPin('')
      void qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const toggleActive = async (u: any) => {
    try {
      await api.users.setActive(u.id, !u.isActive)
      void qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const canManage = session.can('user.manage')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Each user signs in with their own 6-digit PIN. Access is scoped to the companies and shops
          you tick.
        </p>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus /> New user
          </Button>
        )}
      </div>

      <DataTable
        rows={users.data ?? []}
        rowKey={(u: any) => u.id}
        loading={users.isLoading}
        empty="No users yet"
        columns={[
          {
            key: 'name',
            header: 'User',
            render: (u: any) => (
              <div className="flex items-center gap-2.5">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                  style={{ background: u.avatarColor ?? '#4f46e5' }}
                >
                  {initials(u.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {u.name}
                    {u.isSystem && <Badge variant="muted" className="ml-2">Built-in</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{u.username}</p>
                </div>
              </div>
            )
          },
          {
            key: 'role',
            header: 'Role',
            render: (u: any) => <Badge variant="secondary">{ROLE_LABELS[u.role as never] ?? u.role}</Badge>
          },
          {
            key: 'access',
            header: 'Access',
            render: (u: any) => (
              <span className="text-xs text-muted-foreground">
                {u.role === 'admin'
                  ? 'Everything'
                  : `${u.companyIds.length} company · ${u.shopIds.length} shop(s)`}
              </span>
            )
          },
          {
            key: 'lastLoginAt',
            header: 'Last login',
            hideBelow: 'md',
            render: (u: any) => (
              <span className="text-xs text-muted-foreground">
                {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}
              </span>
            )
          },
          {
            key: 'status',
            header: 'Status',
            render: (u: any) =>
              !u.isActive ? (
                <Badge variant="muted">Disabled</Badge>
              ) : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
                <Badge variant="danger">Locked</Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )
          },
          {
            key: 'actions',
            header: '',
            width: '160px',
            render: (u: any) =>
              canManage ? (
                <div className="flex justify-end gap-1">
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Unlock"
                      onClick={async () => {
                        await api.users.unlock(u.id)
                        void qc.invalidateQueries({ queryKey: ['users'] })
                      }}
                    >
                      <Unlock />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Reset PIN"
                    onClick={() => {
                      setResetFor(u)
                      setResetPin('')
                    }}
                  >
                    <KeyRound />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => openEdit(u)}>
                    <Pencil />
                  </Button>
                  {!u.isSystem && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={u.isActive ? 'Disable' : 'Enable'}
                      onClick={() => void toggleActive(u)}
                    >
                      <Lock />
                    </Button>
                  )}
                </div>
              ) : null
          }
        ]}
      />

      {/* ------------------------------------------------------- edit user */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="max-h-[88vh]">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              Creating a user takes three things: a name, a username and a 6-digit PIN.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name" required>
                <Input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Username" required hint="Lowercase, no spaces">
                <Input
                  value={draft.username}
                  onChange={(e) =>
                    setDraft({ ...draft, username: e.target.value.toLowerCase().replace(/\s/g, '') })
                  }
                />
              </Field>
              <Field label="Mobile">
                <Input
                  value={draft.phone}
                  onChange={(e) =>
                    setDraft({ ...draft, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })
                  }
                  inputMode="numeric"
                  maxLength={10}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label={draft.id ? 'New PIN (leave blank to keep)' : '6-digit login PIN'}
              required={!draft.id}
            >
              <PinInput value={pin} onChange={setPin} className="justify-start" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role">
                <SimpleSelect
                  value={draft.role}
                  onChange={(v) => setDraft({ ...draft, role: v })}
                  options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="Companies">
                <MultiCombobox
                  values={draft.companyIds}
                  onChange={(v) => setDraft({ ...draft, companyIds: v })}
                  options={(companies.data ?? []).map((c: any) => ({ value: c.id, label: c.name }))}
                  placeholder="Choose companies"
                />
              </Field>
              <Field label="Shops" className="sm:col-span-2">
                <MultiCombobox
                  values={draft.shopIds}
                  onChange={(v) => setDraft({ ...draft, shopIds: v })}
                  options={(shops.data ?? [])
                    .filter((s: any) =>
                      draft.companyIds.length ? draft.companyIds.includes(s.companyId) : true
                    )
                    .map((s: any) => ({
                      value: s.id,
                      label: `${s.name} (${s.code})`,
                      hint: s.companyName
                    }))}
                  placeholder="Choose shops"
                />
              </Field>
            </div>

            {draft.role === 'custom' && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-[13px] font-medium">Pick exactly what this user can do</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {ALL_PERMISSIONS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-[13px]">
                      <Checkbox
                        checked={draft.permissions.includes(p)}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            permissions: v
                              ? [...draft.permissions, p]
                              : draft.permissions.filter((x: string) => x !== p)
                          })
                        }
                      />
                      {PERMISSIONS[p]}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-[13px] font-medium">Ask for a new PIN at first login</p>
                <p className="text-xs text-muted-foreground">
                  Recommended — you never need to know their PIN.
                </p>
              </div>
              <Switch
                checked={draft.mustChangePin}
                onCheckedChange={(v) => setDraft({ ...draft, mustChangePin: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <p className="text-[13px] font-medium">Account active</p>
              <Switch
                checked={draft.isActive}
                onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {draft.id ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------- reset pin */}
      <Dialog open={Boolean(resetFor)} onOpenChange={(v) => !v && setResetFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reset PIN for {resetFor?.name}</DialogTitle>
            <DialogDescription>
              Give them this PIN. They will be asked to set their own at the next login.
            </DialogDescription>
          </DialogHeader>
          <PinInput value={resetPin} onChange={setResetPin} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void resetPinNow()} disabled={resetPin.length !== 6}>
              Reset PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ========================================================================== */
/*  Companies & shops                                                         */
/* ========================================================================== */

function OrgTab() {
  const qc = useQueryClient()
  const session = useSession()
  const companies = useQuery({ queryKey: ['companies-all'], queryFn: () => api.companies.list(true) })
  const shops = useQuery({ queryKey: ['shops-all'], queryFn: () => api.shops.list(undefined, true) })

  const [companyOpen, setCompanyOpen] = React.useState(false)
  const [shopOpen, setShopOpen] = React.useState(false)
  const [editingCompany, setEditingCompany] = React.useState<any>(null)
  const [editingShop, setEditingShop] = React.useState<any>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['companies-all'] })
    void qc.invalidateQueries({ queryKey: ['shops-all'] })
    void useSession.getState().refreshScope()
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Companies</h2>
            <p className="text-[13px] text-muted-foreground">
              Each company keeps its own customers, stock, bills and reports.
            </p>
          </div>
          {session.can('company.manage') && (
            <Button
              size="sm"
              onClick={() => {
                setEditingCompany(null)
                setCompanyOpen(true)
              }}
            >
              <Plus /> New company
            </Button>
          )}
        </div>
        <DataTable
          rows={companies.data ?? []}
          rowKey={(c: any) => c.id}
          loading={companies.isLoading}
          empty="No companies"
          columns={[
            {
              key: 'name',
              header: 'Company',
              render: (c: any) => (
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.legalName}</p>
                </div>
              )
            },
            { key: 'gstin', header: 'GSTIN', render: (c: any) => <span className="font-mono text-xs">{c.gstin ?? '—'}</span> },
            { key: 'state', header: 'State', hideBelow: 'md' },
            { key: 'shopCount', header: 'Shops', align: 'right' },
            {
              key: 'isActive',
              header: 'Status',
              render: (c: any) =>
                c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>
            },
            {
              key: 'actions',
              header: '',
              width: '60px',
              render: (c: any) =>
                session.can('company.manage') ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditingCompany(c)
                      setCompanyOpen(true)
                    }}
                  >
                    <Pencil />
                  </Button>
                ) : null
            }
          ]}
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Shops</h2>
            <p className="text-[13px] text-muted-foreground">
              Add as many shops as you open. Stock, bills and P&L are tracked per shop.
            </p>
          </div>
          {session.can('shop.manage') && (
            <Button
              size="sm"
              onClick={() => {
                setEditingShop(null)
                setShopOpen(true)
              }}
            >
              <Plus /> New shop
            </Button>
          )}
        </div>
        <DataTable
          rows={shops.data ?? []}
          rowKey={(s: any) => s.id}
          loading={shops.isLoading}
          empty="No shops"
          columns={[
            {
              key: 'name',
              header: 'Shop',
              render: (s: any) => (
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.companyName}</p>
                </div>
              )
            },
            { key: 'code', header: 'Code', render: (s: any) => <Badge variant="outline">{s.code}</Badge> },
            {
              key: 'place',
              header: 'Place',
              hideBelow: 'md',
              render: (s: any) => [s.city, s.state].filter(Boolean).join(', ') || '—'
            },
            { key: 'phone', header: 'Phone', hideBelow: 'lg' },
            { key: 'stockCount', header: 'Units in stock', align: 'right' },
            {
              key: 'isActive',
              header: 'Status',
              render: (s: any) =>
                s.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Closed</Badge>
            },
            {
              key: 'actions',
              header: '',
              width: '60px',
              render: (s: any) =>
                session.can('shop.manage') ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditingShop(s)
                      setShopOpen(true)
                    }}
                  >
                    <Pencil />
                  </Button>
                ) : null
            }
          ]}
        />
      </div>

      <CompanyFormDialog
        open={companyOpen}
        onOpenChange={setCompanyOpen}
        initial={editingCompany}
        onSaved={refresh}
      />
      <ShopFormDialog
        open={shopOpen}
        onOpenChange={setShopOpen}
        initial={editingShop}
        companies={companies.data ?? []}
        onSaved={refresh}
      />
    </div>
  )
}

/* ========================================================================== */
/*  Reconciliation reasons                                                    */
/* ========================================================================== */

function ReasonsTab() {
  const qc = useQueryClient()
  const session = useSession()
  const reasons = useReconReasons()
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [direction, setDirection] = React.useState('both')

  const save = async () => {
    try {
      await api.recon.saveReason({ code, label, direction })
      toast.success('Reason saved')
      setOpen(false)
      setCode('')
      setLabel('')
      void qc.invalidateQueries({ queryKey: ['recon-reasons'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          The list offered when a stock check finds a difference. The built-in list covers the usual
          cases; add your own for anything specific to your shops.
        </p>
        {session.can('reconciliation.manage') && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Add reason
          </Button>
        )}
      </div>

      <DataTable
        rows={reasons.data ?? []}
        rowKey={(r: any) => r.code}
        loading={reasons.isLoading}
        columns={[
          { key: 'label', header: 'Reason', render: (r: any) => <span className="font-medium">{r.label}</span> },
          { key: 'code', header: 'Code', render: (r: any) => <span className="font-mono text-xs">{r.code}</span> },
          {
            key: 'direction',
            header: 'Applies to',
            render: (r: any) => (
              <Badge variant="secondary">
                {r.direction === 'shortage' ? 'Shortage' : r.direction === 'excess' ? 'Excess' : 'Both'}
              </Badge>
            )
          },
          {
            key: 'is_system',
            header: '',
            render: (r: any) => (r.is_system ? <Badge variant="muted">Built-in</Badge> : <Badge variant="info">Custom</Badge>)
          }
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New reason</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Label" required>
              <Input
                autoFocus
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value)
                  if (!code) setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 24))
                }}
                placeholder="e.g. Given to a relative"
              />
            </Field>
            <Field label="Code" required>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                className="font-mono uppercase"
              />
            </Field>
            <Field label="Applies to">
              <SimpleSelect
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'both', label: 'Shortage and excess' },
                  { value: 'shortage', label: 'Shortage only' },
                  { value: 'excess', label: 'Excess only' }
                ]}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!code || !label}>
              Save reason
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ========================================================================== */
/*  EMI loan settings                                                          */
/* ========================================================================== */

function LoanSettingsTab() {
  const [penalty, setPenalty] = React.useState<number | ''>('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void (async () => {
      setPenalty(await api.settings.get<number>(SETTING_DEFAULT_PENALTY, 500))
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.settings.set(SETTING_DEFAULT_PENALTY, Number(penalty) || 0)
      toast.success('EMI settings saved')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="size-4" /> EMI loan defaults
        </CardTitle>
        <CardDescription>
          Applied as a suggested penalty whenever an installment is collected after its due date.
          It is always editable at the time of collection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Default late-payment penalty ₹" hint={`Currently ${money(penalty || 0)}`}>
          <Input
            type="number"
            min={0}
            value={penalty}
            disabled={loading}
            onChange={(e) => setPenalty(e.target.value === '' ? '' : Number(e.target.value))}
            className="text-right tnum"
          />
        </Field>
        <Button onClick={() => void save()} loading={saving} disabled={loading}>
          Save
        </Button>
      </CardContent>
    </Card>
  )
}

/* ========================================================================== */
/*  Audit trail                                                               */
/* ========================================================================== */

function AuditTab() {
  const { companyId } = useScope()
  const [range, setRange] = useDateRange('audit')
  const [search, setSearch] = React.useState('')

  const audit = useQuery({
    queryKey: ['audit', companyId, range, search],
    queryFn: () =>
      api.audit.list({
        companyId,
        from: range.from,
        to: range.to,
        search: search || undefined,
        limit: 300
      }),
    enabled: Boolean(companyId)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the trail…"
          className="w-72"
        />
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <DataTable
        rows={audit.data?.rows ?? []}
        rowKey={(r: any) => r.id}
        loading={audit.isLoading}
        empty="Nothing recorded in this period"
        maxHeight="calc(100vh - 380px)"
        columns={[
          { key: 'at', header: 'When', render: (r: any) => formatDateTime(r.at), width: '180px' },
          { key: 'user_name', header: 'Who', render: (r: any) => <span className="font-medium">{r.user_name}</span> },
          { key: 'action', header: 'Action', render: (r: any) => <Badge variant="secondary">{r.action}</Badge> },
          { key: 'summary', header: 'Details', render: (r: any) => r.summary ?? '—' }
        ]}
      />
    </div>
  )
}

/* ========================================================================== */
/*  About                                                                     */
/* ========================================================================== */

function AboutTab() {
  const [info, setInfo] = React.useState<any>(null)
  const [checking, setChecking] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)

  const load = React.useCallback(async () => setInfo(await api.app.info()), [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Software update</CardTitle>
          <CardDescription>
            Updates download in the background and install themselves — the app restarts on its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Installed version</span>
            <span className="font-mono font-medium">{info?.version ?? '—'}</span>
          </div>
          <Button
            variant="outline"
            className="w-full"
            loading={checking}
            onClick={async () => {
              setChecking(true)
              const state = await api.updater.check()
              setChecking(false)
              toast[state.status === 'error' ? 'error' : 'success'](
                state.status === 'none'
                  ? 'You are on the latest version'
                  : state.status === 'available'
                    ? `Version ${state.version} is downloading`
                    : state.status === 'ready'
                      ? `Version ${state.version} is ready — restart to install`
                      : state.status === 'error'
                        ? state.message
                        : 'Checking…'
              )
            }}
          >
            <RefreshCw /> Check for updates now
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> Database
          </CardTitle>
          <CardDescription>Turso (libSQL) — configured in the bundled .env file.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 text-[13px]">
            <Row label="Mode" value={
              info?.db?.mode === 'embedded'
                ? 'Local copy, synced to Turso'
                : info?.db?.mode === 'remote'
                  ? 'Live connection to Turso'
                  : 'Offline only (no credentials)'
            } />
            <Row label="Credentials" value={info?.db?.remoteConfigured ? 'Set' : 'Missing'} />
            <Row label="Last sync" value={info?.db?.lastSyncAt ? relativeTime(info.db.lastSyncAt) : '—'} />
            {info?.db?.lastSyncError && (
              <Row label="Last error" value={<span className="text-destructive">{info.db.lastSyncError}</span>} />
            )}
          </div>

          {info?.db?.mode === 'local-only' && (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs text-warning">
              TURSO_DATABASE_URL is not set. The app works, but data stays on this computer only.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full"
            loading={syncing}
            onClick={async () => {
              setSyncing(true)
              const res = await api.app.sync()
              await load()
              setSyncing(false)
              toast[res?.ok ? 'success' : 'error'](res?.ok ? 'Synced' : `Sync failed: ${res?.error}`)
            }}
          >
            <RefreshCw /> Sync now
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 text-[13px]">
            <Row label="Platform" value={info?.platform ?? '—'} />
            <Row label="Packaged build" value={info?.isPackaged ? 'Yes' : 'No (development)'} />
            <Row label="Data folder" value={<span className="font-mono text-xs">{info?.userDataPath}</span>} />
          </div>
          <Button variant="outline" size="sm" onClick={() => void api.app.openLogs()}>
            <Download /> Open log file
          </Button>
        </CardContent>
      </Card>

      <RecoverBackupCard />
    </div>
  )
}

/**
 * Recovers records from a database backup file that never reached the cloud —
 * for a machine that was writing offline before v1.1.6. Additive only: rows the
 * cloud already has are left alone, and the backup file itself is never changed.
 */
function RecoverBackupCard() {
  const session = useSession()
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  if (!session.can('record.delete')) return null

  const run = async () => {
    const picked = await api.app.pickBackupFile()
    if (!picked?.filePath) return
    setBusy(true)
    setResult(null)
    try {
      const res = await api.app.recoverFromBackup(picked.filePath)
      setResult(res)
      const moved = res.inserted + res.updated
      if (moved === 0 && res.failed === 0) {
        toast.success('Nothing to recover — everything in that file is already saved online')
      } else {
        toast.success(`Recovered ${res.inserted} record(s) to the cloud`, {
          description: res.failed > 0 ? `${res.failed} could not be copied — see below.` : undefined
        })
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4" /> Recover data from a backup file
        </CardTitle>
        <CardDescription>
          If this computer recorded sales or stock while it could not reach the internet, pick its
          backup database file here and anything missing is uploaded to the cloud. Records already
          saved online are left untouched, and the file you choose is never modified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={() => void run()} loading={busy}>
          <Database /> Choose backup file &amp; recover
        </Button>

        <p className="text-xs text-muted-foreground">
          The file is usually in the data folder above, named{' '}
          <span className="font-mono">krishna-replica-lf.db</span> or{' '}
          <span className="font-mono">…salvaged-*</span>.
        </p>

        {result && (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[13px]">
            <Row label="New records uploaded" value={String(result.inserted)} />
            <Row label="Existing records updated" value={String(result.updated)} />
            <Row
              label="Could not be copied"
              value={
                <span className={result.failed > 0 ? 'text-destructive' : undefined}>
                  {result.failed}
                </span>
              }
            />
            {result.details?.length > 0 && (
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {result.details.slice(0, 20).map((d: string, i: number) => (
                  <li key={i}>• {d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  )
}
