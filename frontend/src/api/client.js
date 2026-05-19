import axios from 'axios'
import toast from 'react-hot-toast'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Guard against multiple concurrent 401s racing each other into the
// same redirect — without this every parallel API call on a page
// fires its own toast + setTimeout, which both flashes the toast a
// dozen times AND breaks the browser back-button after login because
// of the location.href thrash.
let sessionExpiredHandled = false

const handleSessionExpired = (reason) => {
  if (sessionExpiredHandled) return
  sessionExpiredHandled = true
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  // Already on the login page? Skip the toast (the user is presumably
  // trying to sign in — surfacing 'session expired' would just be
  // confusing).
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    toast.error(
      reason
        || 'Your session expired after a long idle period. Please sign in again.',
      { duration: 5500, id: 'session-expired' },
    )
    // Small delay so the toast is actually visible before the route
    // swap unmounts it. 1.4s is enough for the user to read the line
    // without feeling stuck.
    setTimeout(() => {
      window.location.href = '/login'
    }, 1400)
  } else if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }
}

// Exposed so AuthContext (or any future component watching for
// scheduled token expiry) can trigger the same flow proactively.
export const triggerSessionExpired = handleSessionExpired

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      handleSessionExpired(err.response?.data?.detail)
    }
    return Promise.reject(err)
  }
)

export default api
