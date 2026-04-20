import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'
import FloatingShapes from '../components/motion/FloatingShapes'
import { Stagger, StaggerItem } from '../components/motion/Stagger'

export default function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const { login } = useAuth()

  const loginReady = username.trim() && password.trim()
  const registerReady = loginReady && confirm.trim() && password === confirm
  const canSubmit = (isRegister ? registerReady : loginReady) && !loading

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isRegister && password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login'
      const body = isRegister
        ? { username, display_name: displayName || username, password }
        : { username, password }
      const { data } = await api.post(endpoint, body)
      setSuccess(true)
      toast.success(isRegister ? 'Account created!' : 'Welcome back!')
      setTimeout(() => login(data.access_token, data.user), 450)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <FloatingShapes count={6} palette="default" opacity={0.22} minSize={220} maxSize={520} />

      <Stagger className="relative z-10 w-full max-w-md" delayChildren={0.05} staggerChildren={0.1}>
        <StaggerItem className="text-center mb-8">
          <motion.img
            src={logo}
            alt="Logo"
            className="w-20 h-20 mx-auto rounded-3xl shadow-toon mb-4"
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          />
          <h1 className="text-3xl font-extrabold text-toon-navy">QA Studio</h1>
          <p className="text-gray-500 mt-1">AI-powered test artifacts for QA teams</p>
        </StaggerItem>

        <StaggerItem>
          <div className="toon-card relative overflow-hidden">
            <div className="flex mb-6 bg-gray-100 rounded-2xl p-1 relative">
              {[
                { id: 'login', label: '🔐 Login', value: false },
                { id: 'register', label: '✨ Register', value: true },
              ].map(tab => {
                const active = isRegister === tab.value
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setIsRegister(tab.value)}
                    className={`relative flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${active ? 'text-toon-blue' : 'text-gray-500'}`}
                  >
                    {active && (
                      <motion.span
                        layoutId="authTab"
                        className="absolute inset-0 bg-white rounded-xl shadow-sm"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className="relative">{tab.label}</span>
                  </button>
                )
              })}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input className="toon-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
              <AnimatePresence initial={false}>
                {isRegister && (
                  <motion.div
                    key="displayName"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <input className="toon-input" placeholder="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                  </motion.div>
                )}
              </AnimatePresence>
              <input className="toon-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
              <AnimatePresence initial={false}>
                {isRegister && (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <input className="toon-input" type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                whileTap={canSubmit ? { scale: 0.95 } : {}}
                type="submit"
                disabled={!canSubmit}
                className={`toon-btn toon-btn-blue w-full text-lg transition-all ${
                  !canSubmit ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    {[0, 1, 2].map(i => (
                      <motion.span
                        key={i}
                        className="inline-block w-2 h-2 rounded-full bg-white"
                        animate={{ y: [0, -5, 0], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
                      />
                    ))}
                  </span>
                ) : isRegister ? 'Create Account' : 'Login'}
              </motion.button>
            </form>

            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-white/95 backdrop-blur flex items-center justify-center"
                >
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 240, damping: 18 }}
                    className="w-20 h-20 rounded-full bg-toon-mint flex items-center justify-center text-white text-4xl shadow-toon-mint"
                  >
                    <motion.svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                      <motion.path
                        d="M5 12 L10 17 L19 7"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </motion.svg>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </StaggerItem>
      </Stagger>
    </div>
  )
}
