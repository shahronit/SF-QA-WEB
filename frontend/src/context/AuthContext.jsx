import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { triggerSessionExpired } from '../api/client'

const AuthContext = createContext(null)

// Decode the payload portion of a JWT WITHOUT verifying the signature.
// We only care about the `exp` claim to schedule a friendly idle
// warning — the backend still verifies every token on every request,
// so a bad / tampered payload here can't grant the user anything they
// don't already have.
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // JWT base64url -> standard base64 (replace - / _ + pad).
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// "Soft" idle warning fires this many ms BEFORE the JWT actually
// expires so the user has a chance to save their work before being
// kicked. 2 minutes is generous enough that a slow human reaction
// still gets the toast.
const IDLE_PRE_EXPIRY_WARN_MS = 2 * 60 * 1000

// Cap any scheduled timer at ~24 days so setTimeout's signed-32-bit
// overflow (which silently fires immediately) can never bite — long
// JWT_EXPIRE_MINUTES values would otherwise blow past INT_MAX.
const MAX_TIMER_MS = 2 ** 31 - 1

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
  // Timers driven by the JWT exp claim. The warn-timer flashes a
  // "you'll be signed out in 2 minutes" toast; the kick-timer
  // triggers the same session-expired flow as a real 401, so the
  // user is bounced cleanly to /login with a toast — even if they
  // never tried to make an API call (e.g. left the dashboard tab
  // open overnight).
  const warnTimerRef = useRef(null)
  const kickTimerRef = useRef(null)

  const clearExpiryTimers = useCallback(() => {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current)
      warnTimerRef.current = null
    }
    if (kickTimerRef.current) {
      clearTimeout(kickTimerRef.current)
      kickTimerRef.current = null
    }
  }, [])

  const scheduleExpiryTimers = useCallback((tokenValue) => {
    clearExpiryTimers()
    const payload = decodeJwtPayload(tokenValue)
    const expSec = payload?.exp
    if (!Number.isFinite(expSec)) return
    const expMs = expSec * 1000
    const now = Date.now()
    const msUntilExpiry = expMs - now
    if (msUntilExpiry <= 0) {
      // Stored token is already stale — surface the expired flow
      // immediately so the user re-authenticates instead of waiting
      // for the next API call to 401.
      triggerSessionExpired(
        'Your previous session has expired. Please sign in again.',
      )
      return
    }
    const warnIn = Math.max(0, msUntilExpiry - IDLE_PRE_EXPIRY_WARN_MS)
    if (warnIn > 0 && warnIn < MAX_TIMER_MS) {
      warnTimerRef.current = setTimeout(() => {
        toast(
          'You\'ve been idle for a while — your session will end in 2 minutes. Save your work and sign in again to continue.',
          { duration: 12000, icon: '\u23F0', id: 'session-warning' },
        )
      }, warnIn)
    }
    const kickIn = Math.min(msUntilExpiry, MAX_TIMER_MS)
    kickTimerRef.current = setTimeout(() => {
      triggerSessionExpired(
        'Your session expired after a long idle period. Please sign in again.',
      )
    }, kickIn)
  }, [clearExpiryTimers])

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
      scheduleExpiryTimers(savedToken)
    }
    setLoading(false)
    return clearExpiryTimers
  }, [scheduleExpiryTimers, clearExpiryTimers])

  const persist = useCallback((tokenValue, userData) => {
    const norm = normalizeUser(userData)
    if (tokenValue) localStorage.setItem('token', tokenValue)
    if (norm) localStorage.setItem('user', JSON.stringify(norm))
    if (tokenValue) {
      setToken(tokenValue)
      scheduleExpiryTimers(tokenValue)
    }
    if (norm) setUser(norm)
  }, [scheduleExpiryTimers])

  const login = (tokenValue, userData) => {
    persist(tokenValue, userData)
    navigate('/')
  }

  const logout = () => {
    clearExpiryTimers()
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
