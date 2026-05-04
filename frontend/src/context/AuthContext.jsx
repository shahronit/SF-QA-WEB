import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'

const AuthContext = createContext(null)

// Pull through every admin-facing field returned by /login, /register
// and /api/auth/me so consumers (Sidebar, Hub, AdminRoute, AgentForm)
// can gate UI without re-fetching. The backend always returns these
// keys now (with defaults); legacy stored users get refreshed on the
// next /me call from refreshUser().
function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    username: raw.username,
    display_name: raw.display_name || raw.username,
    is_admin: !!raw.is_admin,
    agent_access: raw.agent_access ?? null,
    menu_visibility: {
      manual: raw.menu_visibility?.manual !== false,
      advanced: raw.menu_visibility?.advanced !== false,
    },
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    if (savedToken && savedUser) {
      setToken(savedToken)
      try {
        setUser(normalizeUser(JSON.parse(savedUser)))
      } catch {
        setUser(null)
      }
    }
    setLoading(false)
  }, [])

  const persist = useCallback((tokenValue, userData) => {
    const norm = normalizeUser(userData)
    if (tokenValue) localStorage.setItem('token', tokenValue)
    if (norm) localStorage.setItem('user', JSON.stringify(norm))
    if (tokenValue) setToken(tokenValue)
    if (norm) setUser(norm)
  }, [])

  const login = (tokenValue, userData) => {
    persist(tokenValue, userData)
    navigate('/')
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
    navigate('/login')
  }

  // Re-fetch the current user from /api/auth/me. Used after the admin
  // panel changes the caller's own privileges (so they see the demoted
  // sidebar / lose the Admin link without logging out and back in).
  // Returns the latest user object (or null on failure) so callers can
  // chain on the result without waiting for state to flush.
  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me')
      const norm = normalizeUser(data?.user)
      if (norm) {
        localStorage.setItem('user', JSON.stringify(norm))
        setUser(norm)
      }
      return norm
    } catch {
      return null
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
