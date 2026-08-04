import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useAnalyticsPageViews } from '@/hooks/useAnalyticsPageViews'
import AppLayout from '@/layouts/AppLayout'
const Login = lazy(() => import('@/pages/auth/Login'))
const Register = lazy(() => import('@/pages/auth/Register'))
const AppsIndex = lazy(() => import('@/pages/apps/Index'))
const AppsShow = lazy(() => import('@/pages/apps/Show'))
const CompetitorsIndex = lazy(() => import('@/pages/competitors/Index'))
const Settings = lazy(() => import('@/pages/Settings'))
const ApiTokens = lazy(() => import('@/pages/settings/ApiTokens'))
const McpSetup = lazy(() => import('@/pages/settings/Mcp'))
const PublishersIndex = lazy(() => import('@/pages/publishers/Index'))
const PublishersShow = lazy(() => import('@/pages/publishers/Show'))
const AppChanges = lazy(() => import('@/pages/changes/AppChanges'))
const CompetitorChanges = lazy(() => import('@/pages/changes/CompetitorChanges'))
const DiscoveryApps = lazy(() => import('@/pages/discovery/Apps'))
const DiscoveryPublishers = lazy(() => import('@/pages/discovery/Publishers'))
const Trending = lazy(() => import('@/pages/discovery/Trending'))
const ExplorerScreenshots = lazy(() => import('@/pages/explorer/Screenshots'))
const ExplorerIcons = lazy(() => import('@/pages/explorer/Icons'))
const AsoIndex = lazy(() => import('@/pages/aso/Index'))

const loading = <div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

function AuthGuard() {
  const { token, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!token) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function GuestGuard() {
  const { token, isLoading } = useAuthStore()

  if (isLoading) return null

  if (token) {
    return <Navigate to="/discovery/trending" replace />
  }

  return <Outlet />
}

function AnalyticsTracker() {
  useAnalyticsPageViews()
  return null
}

export default function Router() {
  return (
    <BrowserRouter>
      <AnalyticsTracker />
      <Suspense fallback={loading}><Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route element={<GuestGuard />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            {/* Discovery */}
            <Route path="/discovery/apps" element={<DiscoveryApps />} />
            <Route path="/discovery/publishers" element={<DiscoveryPublishers />} />
            <Route path="/discovery/trending" element={<Trending />} />

            {/* Tracking */}
            <Route path="/apps" element={<AppsIndex />} />
            <Route path="/apps/:platform/:externalId" element={<AppsShow />} />
            <Route path="/competitors" element={<CompetitorsIndex />} />
            <Route path="/changes/apps" element={<AppChanges />} />
            <Route path="/changes/competitors" element={<CompetitorChanges />} />

            {/* Explorer */}
            <Route path="/explorer/screenshots" element={<ExplorerScreenshots />} />
            <Route path="/explorer/icons" element={<ExplorerIcons />} />

            {/* ASO */}
            <Route path="/aso" element={<Navigate to="/aso/explorer" replace />} />
            <Route path="/aso/explorer" element={<AsoIndex />} />
            <Route path="/aso/density" element={<AsoIndex />} />
            <Route path="/aso/compare" element={<AsoIndex />} />

            {/* Publishers */}
            <Route path="/publishers" element={<PublishersIndex />} />
            <Route path="/publishers/:platform/:externalId" element={<PublishersShow />} />

            {/* Account */}
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/api-tokens" element={<ApiTokens />} />
            <Route path="/settings/mcp" element={<McpSetup />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes></Suspense>
    </BrowserRouter>
  )
}
