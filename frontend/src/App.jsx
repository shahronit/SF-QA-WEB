import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AgentResultsProvider } from './context/AgentResultsContext'
import { JiraProvider } from './context/JiraContext'
import { TestManagementProvider } from './context/TestManagementContext'
import { SessionPrefsProvider } from './context/SessionPrefsContext'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Hub from './pages/Hub'

// Every other page is code-split. Login + Hub stay eager because:
//   - Login is the entrypoint (no route to navigate from yet).
//   - Hub is the post-login landing page (loaded on every fresh login).
// Everything else is a per-agent surface that the user reaches by
// clicking the sidebar; lazy-loading them slashes the initial bundle
// from ~all 23 pages down to ~2, so first paint is dramatically faster
// and each page chunk only loads when actually visited (browser caches
// it for subsequent navigations). Vite emits one chunk per dynamic
// import, no extra config required.
const Requirements    = lazy(() => import('./pages/Requirements'))
const TestCases       = lazy(() => import('./pages/TestCases'))
const BugReports      = lazy(() => import('./pages/BugReports'))
const SmokeTests      = lazy(() => import('./pages/SmokeTests'))
const Regression      = lazy(() => import('./pages/Regression'))
const Estimation      = lazy(() => import('./pages/Estimation'))
const Projects        = lazy(() => import('./pages/Projects'))
const History         = lazy(() => import('./pages/History'))
const TestPlanDoc     = lazy(() => import('./pages/TestPlanDoc'))
const AutomationPlan  = lazy(() => import('./pages/AutomationPlan'))
const CopadoScript    = lazy(() => import('./pages/CopadoScript'))
const TestData        = lazy(() => import('./pages/TestData'))
const RTM             = lazy(() => import('./pages/RTM'))
const UATPlan         = lazy(() => import('./pages/UATPlan'))
const ExecutionReport = lazy(() => import('./pages/ExecutionReport'))
const RCA             = lazy(() => import('./pages/RCA'))
const ClosureReport   = lazy(() => import('./pages/ClosureReport'))
const StlcPack        = lazy(() => import('./pages/StlcPack'))
const ResultView      = lazy(() => import('./pages/ResultView'))
const TestCaseEditor  = lazy(() => import('./pages/TestCaseEditor'))
const Admin           = lazy(() => import('./pages/Admin'))

// Tiny fallback that paints immediately while the chunk loads. We
// deliberately avoid framer-motion here so the very first frame is
// cheap — chunks usually arrive in <150ms on a warm cache and the
// fallback is barely visible.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-toon-blue/70 font-bold animate-pulse">Loading…</div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-2xl text-toon-blue animate-bounce font-bold">Loading...</div></div>
  if (!user) return <Navigate to="/login" />
  return children
}

// Mirror of ProtectedRoute that additionally requires is_admin. Non-admins
// hitting /admin (e.g. via a stale bookmark) get bounced to the Hub
// instead of seeing a confusing 403 page.
function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-2xl text-toon-blue animate-bounce font-bold">Loading...</div></div>
  if (!user) return <Navigate to="/login" />
  if (!user.is_admin) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <SessionPrefsProvider>
      <JiraProvider>
        <TestManagementProvider>
          <AgentResultsProvider>
          <Toaster position="top-right" toastOptions={{ duration: 3000, style: { borderRadius: '16px', fontFamily: 'Nunito' } }} />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/login" element={<Login />} />
          {/* Standalone, chrome-less result viewer opened from History in a
              new tab. Sits outside <Layout> so the new window has no sidebar
              or header — just the report. Still gated by ProtectedRoute. */}
          <Route path="/result/view" element={<ProtectedRoute><ResultView /></ProtectedRoute>} />
          {/* Pop-out test-case editor opened from TestManagementPush. Lives
              outside <Layout> so the popup window has no sidebar / header,
              just the structured form. Communicates back to its opener via
              window.postMessage on save. */}
          <Route path="/test-case-editor" element={<ProtectedRoute><TestCaseEditor /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Hub />} />
            <Route path="requirements" element={<Requirements />} />
            <Route path="testcases" element={<TestCases />} />
            <Route path="bugs" element={<BugReports />} />
            <Route path="smoke" element={<SmokeTests />} />
            <Route path="regression" element={<Regression />} />
            <Route path="estimation" element={<Estimation />} />
            <Route path="test-strategy" element={<Navigate to="/test-plan" replace />} />
            <Route path="test-plan" element={<TestPlanDoc />} />
            <Route path="automation-plan" element={<AutomationPlan />} />
            <Route path="copado-scripts" element={<CopadoScript />} />
            <Route path="test-data" element={<TestData />} />
            <Route path="rtm" element={<RTM />} />
            <Route path="uat-plan" element={<UATPlan />} />
            <Route path="execution-report" element={<ExecutionReport />} />
            <Route path="rca" element={<RCA />} />
            <Route path="closure-report" element={<ClosureReport />} />
            <Route path="stlc-pack" element={<StlcPack />} />
            <Route path="projects" element={<Projects />} />
            <Route path="history" element={<History />} />
            <Route
              path="admin"
              element={<AdminRoute><Admin /></AdminRoute>}
            />
          </Route>
        </Routes>
        </Suspense>
          </AgentResultsProvider>
        </TestManagementProvider>
      </JiraProvider>
      </SessionPrefsProvider>
    </AuthProvider>
  )
}
