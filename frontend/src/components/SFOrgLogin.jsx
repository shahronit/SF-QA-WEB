import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import toast from 'react-hot-toast'

const LOGIN_TYPES = [
  { value: 'Production (login.salesforce.com)', label: 'Production' },
  { value: 'Sandbox (test.salesforce.com)', label: 'Sandbox' },
  { value: 'Custom Domain', label: 'Custom Domain' },
]

export default function SFOrgLogin({ onMetadata }) {
  const [open, setOpen] = useState(false)
  const [loginType, setLoginType] = useState(LOGIN_TYPES[1].value)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [securityToken, setSecurityToken] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(null)

  const canLogin = username.trim() && password.trim() &&
    (loginType !== 'Custom Domain' || customDomain.trim()) && !loading

  const handleReset = () => {
    setUsername('')
    setPassword('')
    setSecurityToken('')
    setCustomDomain('')
    setLoginType(LOGIN_TYPES[1].value)
    setConnected(null)
    onMetadata('')
  }

  const handleLogin = async () => {
    if (!canLogin) return
    setLoading(true)
    try {
      const { data } = await api.post('/sf/login', {
        username: username.trim(),
        password: password.trim(),
        security_token: securityToken.trim(),
        login_type: loginType,
        custom_domain: customDomain.trim(),
      })
      setConnected({
        label: data.org_label,
        env: data.is_sandbox ? 'Sandbox' : 'Production',
        url: data.instance_url,
        summary: data.summary,
      })
      onMetadata(data.summary)
      toast.success(`Connected to ${data.org_label}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const disconnect = () => {
    setConnected(null)
    onMetadata('')
    toast.success('Disconnected from org')
  }

  return (
    <div className="toon-card mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full text-left"
      >
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-white text-sm shadow-toon">
          ☁️
        </span>
        <div className="flex-1">
          <span className="font-bold text-toon-navy text-sm">Connect to Salesforce Org</span>
          <span className="text-xs text-gray-400 ml-2">(optional)</span>
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          className="text-gray-400 text-lg"
        >
          ▼
        </motion.span>
      </button>

      {connected && (
        <div className="mt-3 flex items-center gap-3 bg-toon-mint/10 border border-toon-mint/30 rounded-2xl px-4 py-2.5">
          <span className="text-lg">✅</span>
          <div className="flex-1">
            <span className="font-bold text-toon-navy text-sm">{connected.label}</span>
            <span className="text-xs text-gray-500 ml-2">({connected.env}) — {connected.url}</span>
          </div>
          <button onClick={disconnect} className="text-xs text-toon-coral font-bold hover:underline">
            Disconnect
          </button>
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">
              <p className="text-xs text-gray-500">
                Log in to your Salesforce org to fetch live metadata (objects, flows, validation rules, profiles) for richer test plans.
              </p>

              <div>
                <label className="block text-sm font-bold text-toon-navy mb-1.5">Login endpoint</label>
                <div className="flex gap-2">
                  {LOGIN_TYPES.map(lt => (
                    <button
                      key={lt.value}
                      onClick={() => setLoginType(lt.value)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        loginType === lt.value
                          ? 'bg-toon-blue text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {lt.label}
                    </button>
                  ))}
                </div>
              </div>

              {loginType === 'Custom Domain' && (
                <div>
                  <label className="block text-sm font-bold text-toon-navy mb-1.5">Custom domain</label>
                  <input
                    className="toon-input"
                    placeholder="mycompany.my.salesforce.com"
                    value={customDomain}
                    onChange={e => setCustomDomain(e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-toon-navy mb-1.5">Username</label>
                  <input
                    className="toon-input"
                    placeholder="user@company.com"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-toon-navy mb-1.5">Password</label>
                  <input
                    className="toon-input"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-toon-navy mb-1.5">Security token <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  className="toon-input"
                  type="password"
                  placeholder="Leave blank if not required"
                  value={securityToken}
                  onChange={e => setSecurityToken(e.target.value)}
                />
              </div>

              <div className="flex gap-3">
                <motion.button
                  whileTap={canLogin ? { scale: 0.95 } : {}}
                  onClick={handleLogin}
                  disabled={!canLogin}
                  className={`toon-btn toon-btn-blue flex-1 transition-all ${
                    !canLogin ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin">⚙️</span> Authenticating...
                    </span>
                  ) : '🔐 Login & Fetch Metadata'}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleReset}
                  type="button"
                  className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-4"
                >
                  🔄 Reset
                </motion.button>
              </div>

              {connected?.summary && (
                <details className="bg-gray-50 rounded-2xl p-4">
                  <summary className="cursor-pointer text-sm font-bold text-toon-navy">Preview fetched metadata</summary>
                  <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap max-h-60 overflow-auto">
                    {connected.summary.slice(0, 2000)}
                  </pre>
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
