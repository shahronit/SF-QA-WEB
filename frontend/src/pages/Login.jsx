import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'
import AuroraBg from '../components/motion/AuroraBg'
import MagneticButton from '../components/motion/MagneticButton'
import SparkleCursor from '../components/motion/SparkleCursor'
import Icon3D from '../components/icons/Icon3D'
import QdecFooter from '../components/QdecFooter'
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
    <div className="min-h-screen w-full bg-astound-deep text-astound-cream font-astound relative overflow-hidden">
      <SparkleCursor />

      {/* Two-column portal: aurora hero + glass form. Collapses to a single
          column under lg so the login form is always above the hero copy. */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 min-h-screen">

        {/* ---------------------- LEFT: Astound hero ----------------------- */}
        <section className="relative flex flex-col justify-between p-8 lg:p-14 overflow-hidden">
          <AuroraBg intensity="full" />

          <Stagger className="relative z-10 max-w-xl" delayChildren={0.05} staggerChildren={0.08}>
            <StaggerItem>
              <div className="flex items-center gap-3">
                <motion.img
                  src={logo}
                  alt="QA Studio"
                  className="w-12 h-12 rounded-2xl shadow-astound border border-white/15"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                />
                <div>
                  <div className="text-sm uppercase tracking-[0.22em] text-white/55 font-astound">
                    by Astound Digital
                  </div>
                  <div className="font-display text-2xl font-bold leading-tight">
                    QDEC Center
                  </div>
                </div>
              </div>
            </StaggerItem>

            <StaggerItem>
              <span className="astound-pill mt-10">
                <Icon3D name="sparkles" size={14} float />
                Internal QA Portal
              </span>
            </StaggerItem>

            <StaggerItem>
              <h1 className="font-display text-5xl lg:text-6xl font-extrabold mt-4 leading-[1.05]">
                <span className="block">QA Studio</span>
                <span className="astound-text-grad block">for Astound Digital</span>
              </h1>
            </StaggerItem>

            <StaggerItem>
              <p className="text-white/70 mt-6 text-lg max-w-md leading-relaxed">
                The Delivery Center QA portal — author requirements, generate test
                cases, push to Jira, and close cycles, all powered by Gemini and
                grounded in your project context.
              </p>
            </StaggerItem>

            <StaggerItem>
              <div className="grid grid-cols-3 gap-3 mt-10 max-w-md">
                {[
                  { name: 'requirement', label: 'Analyze' },
                  { name: 'testcase',    label: 'Author' },
                  { name: 'closure_report', label: 'Close' },
                ].map((it) => (
                  <div
                    key={it.name}
                    className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 flex flex-col items-center gap-2 hover:border-astound-violet/50 transition-colors"
                  >
                    <Icon3D name={it.name} size={36} float tilt />
                    <span className="text-xs text-white/65 uppercase tracking-wider font-bold">
                      {it.label}
                    </span>
                  </div>
                ))}
              </div>
            </StaggerItem>
          </Stagger>

          <div className="relative z-10 mt-10 lg:mt-0">
            <QdecFooter variant="dark" />
          </div>
        </section>

        {/* ---------------------- RIGHT: Glass form ------------------------ */}
        <section className="relative flex items-center justify-center p-6 lg:p-12 bg-astound-deep">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full max-w-md"
          >
            <div className="astound-card relative overflow-hidden p-8">
              <div className="text-center mb-6">
                <div className="text-xs uppercase tracking-[0.22em] text-white/50 font-astound">
                  {isRegister ? 'Create your account' : 'Welcome back'}
                </div>
                <h2 className="font-display text-2xl font-bold text-white mt-1">
                  {isRegister ? 'Join QA Studio' : 'Sign in to QA Studio'}
                </h2>
              </div>

              <div className="flex mb-6 bg-white/5 rounded-2xl p-1 relative border border-white/10">
                {[
                  { id: 'login', label: 'Login', value: false },
                  { id: 'register', label: 'Register', value: true },
                ].map(tab => {
                  const active = isRegister === tab.value
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setIsRegister(tab.value)}
                      className={`relative flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${active ? 'text-white' : 'text-white/55'}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="authTab"
                          className="absolute inset-0 bg-astound-grad rounded-xl shadow-astound"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative">{tab.label}</span>
                    </button>
                  )
                })}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/40 focus:outline-none focus:border-astound-violet focus:ring-4 focus:ring-astound-violet/25 transition-all"
                  placeholder="Username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                />
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
                      <input
                        className="w-full px-4 py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/40 focus:outline-none focus:border-astound-violet focus:ring-4 focus:ring-astound-violet/25 transition-all"
                        placeholder="Display name"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <input
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/40 focus:outline-none focus:border-astound-violet focus:ring-4 focus:ring-astound-violet/25 transition-all"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
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
                      <input
                        className="w-full px-4 py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white placeholder-white/40 focus:outline-none focus:border-astound-violet focus:ring-4 focus:ring-astound-violet/25 transition-all"
                        type="password"
                        placeholder="Confirm password"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        required
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <MagneticButton className="w-full block">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="astound-btn-grad w-full text-base"
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
                    ) : isRegister ? 'Create Account' : 'Sign in'}
                  </button>
                </MagneticButton>
              </form>

              <p className="text-[11px] text-white/45 mt-4 text-center leading-relaxed">
                By continuing you agree to use QA Studio in line with the
                Astound Digital internal acceptable-use policy.
              </p>

              <AnimatePresence>
                {success && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-astound-deep/95 backdrop-blur flex items-center justify-center"
                  >
                    <motion.div
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 240, damping: 18 }}
                      className="w-20 h-20 rounded-full bg-astound-grad flex items-center justify-center text-white text-4xl shadow-astound"
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

            <div className="lg:hidden mt-6">
              <QdecFooter variant="dark" />
            </div>
          </motion.div>
        </section>
      </div>
    </div>
  )
}
