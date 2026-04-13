import { useState } from 'react'
import { motion } from 'framer-motion'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'

export default function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
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
      login(data.access_token, data.user)
      toast.success(isRegister ? 'Account created!' : 'Welcome back!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="toon-blob w-[500px] h-[500px] bg-toon-blue -top-40 -right-40 absolute" />
      <div className="toon-blob w-[400px] h-[400px] bg-toon-coral -bottom-32 -left-32 absolute" />
      <div className="toon-blob w-[300px] h-[300px] bg-toon-purple top-1/2 left-1/3 absolute" />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.img
            src={logo}
            alt="Logo"
            className="w-20 h-20 mx-auto rounded-3xl shadow-toon mb-4"
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          />
          <h1 className="text-3xl font-extrabold text-toon-navy">Salesforce QA Studio</h1>
          <p className="text-gray-500 mt-1">AI-powered test artifacts for Salesforce teams</p>
        </div>

        <div className="toon-card">
          <div className="flex mb-6 bg-gray-100 rounded-2xl p-1">
            <button
              onClick={() => setIsRegister(false)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${!isRegister ? 'bg-white text-toon-blue shadow-sm' : 'text-gray-500'}`}
            >🔐 Login</button>
            <button
              onClick={() => setIsRegister(true)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${isRegister ? 'bg-white text-toon-blue shadow-sm' : 'text-gray-500'}`}
            >✨ Register</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input className="toon-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
            {isRegister && <input className="toon-input" placeholder="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} />}
            <input className="toon-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
            {isRegister && <input className="toon-input" type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} required />}
            <motion.button
              whileTap={canSubmit ? { scale: 0.95 } : {}}
              type="submit"
              disabled={!canSubmit}
              className={`toon-btn toon-btn-blue w-full text-lg transition-all ${
                !canSubmit ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Login'}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
