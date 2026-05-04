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
import Requirements from './pages/Requirements'
import TestCases from './pages/TestCases'
import BugReports from './pages/BugReports'
import SmokeTests from './pages/SmokeTests'
import Regression from './pages/Regression'
import Estimation from './pages/Estimation'
import Projects from './pages/Projects'
import History from './pages/History'
import TestPlanDoc from './pages/TestPlanDoc'
import AutomationPlan from './pages/AutomationPlan'
import CopadoScript from './pages/CopadoScript'
import TestData from './pages/TestData'
import RTM from './pages/RTM'
import UATPlan from './pages/UATPlan'
import ExecutionReport from './pages/ExecutionReport'
import RCA from './pages/RCA'
import ClosureReport from './pages/ClosureReport'
import StlcPack from './pages/StlcPack'
import ResultView from './pages/ResultView'
import TestCaseEditor from './pages/TestCaseEditor'
import Admin from './pages/Admin'

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
          </AgentResultsProvider>
        </TestManagementProvider>
      </JiraProvider>
      </SessionPrefsProvider>
    </AuthProvider>
  )
}
