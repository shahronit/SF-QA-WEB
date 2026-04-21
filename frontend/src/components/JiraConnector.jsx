import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { useJira } from '../context/JiraContext'

export default function JiraConnector({ compact = false }) {
  const { connected, jiraUrl, email, projects, loading, connect, disconnect } = useJira()
  const [open, setOpen] = useState(!connected)
  const [url, setUrl] = useState('')
  const [mail, setMail] = useState('')
  const [token, setToken] = useState('')

  const canConnect = url.trim() && mail.trim() && token.trim() && !loading

  const handleConnect = async (e) => {
    e?.preventDefault?.()
    if (!canConnect) return
    try {
      await connect({ jira_url: url.trim(), email: mail.trim(), api_token: token.trim() })
      toast.success('Connected to Jira!')
      setOpen(false)
      setUrl(''); setMail(''); setToken('')
    } catch (err) {
      console.error('Jira connect failed:', err)
      const detail = err?.response?.data?.detail
      const status = err?.response?.status
      const networkMsg = err?.message
      const msg = detail
        ? `Jira: ${detail}`
        : status
          ? `Jira connect failed (HTTP ${status})`
          : networkMsg
            ? `Jira connect failed: ${networkMsg}`
            : 'Failed to connect to Jira (no response from server)'
      toast.error(msg, { duration: 8000 })
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnect()
      toast.success('Disconnected from Jira')
      setOpen(true)
    } catch {
      toast.error('Failed to disconnect')
    }
  }

  return (
    <div className="toon-card !p-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm shadow-toon">
          🧩
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-toon-navy">
              Jira Integration
              {connected && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-toon-mint font-bold">
                  <span>●</span> Connected
                </span>
              )}
            </h3>
            <button
              onClick={() => setOpen(o => !o)}
              className="text-xs text-toon-blue hover:underline font-semibold"
            >
              {open ? 'Hide' : (connected ? 'Manage' : 'Connect')}
            </button>
          </div>
          {connected && !open && (
            <p className="text-xs text-gray-500 mt-1">
              {email} @ {jiraUrl} — {projects.length} project{projects.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 ml-12 space-y-3">
              {connected ? (
                <div className="space-y-3">
                  <div className="text-sm text-gray-700">
                    <p><strong>URL:</strong> {jiraUrl}</p>
                    <p><strong>Email:</strong> {email}</p>
                    <p><strong>Projects:</strong> {projects.length}</p>
                  </div>
                  {!compact && projects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {projects.slice(0, 12).map(p => (
                        <span key={p.key} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold">
                          {p.key}
                        </span>
                      ))}
                      {projects.length > 12 && (
                        <span className="text-xs text-gray-400">+{projects.length - 12} more</span>
                      )}
                    </div>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleDisconnect}
                    disabled={loading}
                    className="toon-btn bg-toon-coral text-white text-sm px-4"
                  >
                    Disconnect
                  </motion.button>
                </div>
              ) : (
                <form onSubmit={handleConnect} className="space-y-3">
                  <input
                    className="toon-input !py-2 text-sm"
                    placeholder="https://your-domain.atlassian.net"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                  />
                  <input
                    className="toon-input !py-2 text-sm"
                    type="email"
                    placeholder="your-email@company.com"
                    value={mail}
                    onChange={e => setMail(e.target.value)}
                  />
                  <input
                    className="toon-input !py-2 text-sm"
                    type="password"
                    placeholder="API token (id.atlassian.com/manage-profile/security/api-tokens)"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                  />
                  <motion.button
                    whileTap={canConnect ? { scale: 0.95 } : {}}
                    type="submit"
                    disabled={!canConnect}
                    className={`toon-btn toon-btn-blue text-sm w-full ${
                      !canConnect ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    {loading ? 'Connecting…' : '🔗 Connect to Jira'}
                  </motion.button>
                </form>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
