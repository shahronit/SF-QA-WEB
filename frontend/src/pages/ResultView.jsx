import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import ReportPanel from '../components/ReportPanel'

const AGENT_LABELS = {
  requirement: '📝 Requirements',
  testcase: '🧪 Test Cases',
  bug_report: '🐛 Bug Reports',
  smoke: '💨 Smoke Tests',
  regression: '🔄 Regression',
  estimation: '📊 Estimation',
}

// Standalone agent-result viewer opened in a new tab from the History page.
// Reads its payload from sessionStorage (keyed by a UUID we put in the URL)
// so we don't need a backend "single record by id" endpoint or a stable
// history id story for now.
export default function ResultView() {
  const [params] = useSearchParams()
  const key = params.get('key') || ''
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!key) {
      setError('Missing result key in URL.')
      return
    }
    try {
      const raw = sessionStorage.getItem(`qaResult:${key}`)
      if (!raw) {
        setError('This result is no longer available in this browser session. Re-open it from the History page.')
        return
      }
      setPayload(JSON.parse(raw))
    } catch {
      setError('Failed to load the stored result.')
    }
  }, [key])

  const tsLabel = useMemo(() => {
    if (!payload?.ts) return ''
    return payload.ts.slice(0, 19).replace('T', ' ')
  }, [payload])

  const agentLabel = payload?.agentName
    ? AGENT_LABELS[payload.agentName] || payload.agentName
    : ''

  return (
    <div className="min-h-screen bg-toon-cream font-toon p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-toon-navy">
              Agent Result
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Standalone view — close this tab when you're done.
            </p>
            {(agentLabel || payload?.project || tsLabel) && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {agentLabel && (
                  <span className="toon-badge bg-toon-blue/10 text-toon-blue text-xs font-bold">
                    {agentLabel}
                  </span>
                )}
                {payload?.project && (
                  <span className="toon-badge bg-emerald-50 text-emerald-700 text-xs font-bold">
                    📂 {payload.project}
                  </span>
                )}
                {tsLabel && (
                  <span className="text-xs text-gray-400">{tsLabel}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/history"
              className="toon-btn bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm py-2 px-4"
            >
              ← Back to History
            </Link>
          </div>
        </header>

        {error ? (
          <div className="toon-card text-center">
            <p className="text-toon-coral font-bold mb-2">Result not available</p>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <Link
              to="/history"
              className="toon-btn toon-btn-blue text-sm py-2 px-4 inline-block"
            >
              Go to History
            </Link>
          </div>
        ) : !payload ? (
          <div className="toon-card text-center text-gray-400">Loading…</div>
        ) : (
          <ReportPanel
            content={payload.markdown || ''}
            agentName={payload.agentName || ''}
          />
        )}
      </div>
    </div>
  )
}
