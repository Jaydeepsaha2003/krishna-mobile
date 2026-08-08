import * as React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { FEATURES } from '@shared/constants'
import { useSession } from '@/store/session'
import { AppShell } from '@/components/layout/AppShell'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { NewSalePage } from '@/features/sales/NewSalePage'
import { SalesPage } from '@/features/sales/SalesPage'
import { CreditPage } from '@/features/credit/CreditPage'
import { PurchasesPage } from '@/features/purchases/PurchasesPage'
import { NewPurchasePage } from '@/features/purchases/NewPurchasePage'
import { StockPage } from '@/features/stock/StockPage'
import { TransfersPage } from '@/features/transfers/TransfersPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { SuppliersPage } from '@/features/suppliers/SuppliersPage'
import { CataloguePage } from '@/features/catalogue/CataloguePage'
import { ReconciliationPage } from '@/features/reconciliation/ReconciliationPage'
import { ReconciliationDetailPage } from '@/features/reconciliation/ReconciliationDetailPage'
import { NewLoanPage } from '@/features/loans/NewLoanPage'
import { LoansPage } from '@/features/loans/LoansPage'
import { LoanRepaymentPage } from '@/features/loans/LoanRepaymentPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

export default function App() {
  const user = useSession((s) => s.user)
  const ready = useSession((s) => s.ready)
  const [booting, setBooting] = React.useState(true)

  React.useEffect(() => {
    // The main process holds the session; a reload should not force a re-login
    // mid-shift, so we ask whether one already exists.
    void (async () => {
      try {
        const res = await window.api.invoke<any>('auth:session')
        if (res.ok && res.data) {
          const [companies, shops] = await Promise.all([
            window.api.invoke<any>('companies:list', {}),
            window.api.invoke<any>('shops:list', {})
          ])
          useSession.getState().setLogin({
            session: res.data,
            companies: companies.ok ? companies.data : [],
            shops: shops.ok
              ? shops.data.map((s: any) => ({
                  id: s.id,
                  companyId: s.companyId,
                  name: s.name,
                  code: s.code
                }))
              : [],
            mustChangePin: false
          })
        } else {
          useSession.getState().clear()
        }
      } catch {
        useSession.getState().clear()
      } finally {
        setBooting(false)
      }
    })()
  }, [])

  if (booting || !ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <span className="font-bold">KM</span>
          </div>
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!user) return <LoginScreen />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="sales/new" element={<NewSalePage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="credit" element={<CreditPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="purchases/new" element={<NewPurchasePage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="reconciliation" element={<ReconciliationPage />} />
        <Route path="reconciliation/:id" element={<ReconciliationDetailPage />} />
        {FEATURES.emiLoans ? (
          <>
            <Route path="loans/new" element={<NewLoanPage />} />
            <Route path="loans/:id/repay" element={<LoanRepaymentPage />} />
            <Route path="loans" element={<LoansPage />} />
          </>
        ) : (
          // EMI module locked — any /loans URL falls back to the dashboard.
          <Route path="loans/*" element={<Navigate to="/" replace />} />
        )}
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
