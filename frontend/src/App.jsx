import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AgentResultsProvider } from './context/AgentResultsContext'
import { JiraProvider } from './context/JiraContext'
import { TestManagementProvider } from './context/TestManagementContext'
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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-2xl text-toon-blue animate-bounce font-bold">Loading...</div></div>
  if (!user) return <Navigate to="/login" />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <JiraProvider>
        <TestManagementProvider>
          <AgentResultsProvider>
          <Toaster position="top-right" toastOptions={{ duration: 3000, style: { borderRadius: '16px', fontFamily: 'Nunito' } }} />
          <Routes>
          <Route path="/login" element={<Login />} />
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
          </Route>
        </Routes>
          </AgentResultsProvider>
        </TestManagementProvider>
      </JiraProvider>
    </AuthProvider>
  )
}
