import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'

// Poll cadence for the unread badge. 30s is plenty for the registration
// cadence (we expect maybe a few new users a day) and avoids hammering
// the backend; the dropdown also refreshes its full list every time
// the user opens it, so a stale badge is at most ~30s out of date.
const POLL_INTERVAL_MS = 30_000

function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.max(1, Math.floor((Date.now() - t) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Bell-icon dropdown for the in-app admin notification feed.
 *
 * Renders nothing for non-admins; the parent (Sidebar) is also
 * expected to skip mounting it for non-admins, but this guard means
 * a misuse can't accidentally leak admin endpoints through the
 * console (the API itself stays the source of truth — non-admins
 * get a 403).
 */
export default function AdminNotificationsBell({ user }) {
  const isAdmin = !!user?.is_admin
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef(null)

  const refreshCount = useCallback(async () => {
    if (!isAdmin) return
    try {
      const { data } = await api.get('/admin/notifications/unread-count')
      setUnread(Number.isFinite(data?.count) ? data.count : 0)
    } catch {
      // Silent — a transient network blip shouldn't pop a toast on
      // every poll cycle. The badge will simply not update.
    }
  }, [isAdmin])

  const refreshList = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const { data } = await api.get('/admin/notifications', { params: { limit: 20 } })
      setItems(Array.isArray(data?.notifications) ? data.notifications : [])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return undefined
    refreshCount()
    const id = setInterval(refreshCount, POLL_INTERVAL_MS)
    const onFocus = () => refreshCount()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [isAdmin, refreshCount])

  useEffect(() => {
    if (!open) return undefined
    refreshList()
    const onClickAway = (ev) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target)) {
        setOpen(false)
      }
    }
    const onKey = (ev) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, refreshList])

  if (!isAdmin) return null

  const handleManage = async (notif) => {
    if (!notif?.actor_username) return
    // Optimistic — drop the badge by 1 and flip the row immediately so
    // the UI feels instant. We re-sync from the server after navigation
    // anyway via the next poll, so a failed mark-read is forgivable.
    if (!notif.read) {
      setUnread((n) => Math.max(0, n - 1))
      setItems((prev) => prev.map((it) => (it.id === notif.id ? { ...it, read: true } : it)))
      api.post(`/admin/notifications/${notif.id}/read`).catch(() => {})
    }
    setOpen(false)
    navigate(`/admin?user=${encodeURIComponent(notif.actor_username)}`)
  }

  const handleMarkAll = async () => {
    if (!unread) return
    try {
      await api.post('/admin/notifications/mark-all-read')
      setUnread(0)
      setItems((prev) => prev.map((it) => ({ ...it, read: true })))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to mark all read')
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600 hover:text-toon-navy transition-colors"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-toon-coral text-white text-[10px] font-bold flex items-center justify-center shadow-sm"
          >
            {unread > 99 ? '99+' : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="dropdown"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute right-0 mt-2 w-80 max-h-[28rem] overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-100 z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-extrabold text-toon-navy">Notifications</h3>
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={!unread}
                className="text-xs font-semibold text-toon-blue disabled:text-gray-300 disabled:cursor-not-allowed hover:underline"
              >
                Mark all as read
              </button>
            </div>

            <div className="overflow-y-auto max-h-[22rem] divide-y divide-gray-50">
              {loading && (
                <p className="p-6 text-center text-xs text-gray-400">Loading…</p>
              )}
              {!loading && items.length === 0 && (
                <p className="p-6 text-center text-xs text-gray-400">
                  You're all caught up.
                </p>
              )}
              {!loading && items.map((notif) => (
                <div
                  key={notif.id}
                  className={`px-4 py-3 ${notif.read ? 'bg-white' : 'bg-toon-blue/5'}`}
                >
                  <div className="flex items-start gap-2">
                    {!notif.read && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-toon-blue flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-toon-navy truncate">{notif.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{notif.body}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
                          {relativeTime(notif.created)}
                        </span>
                        {notif.actor_username && (
                          <button
                            type="button"
                            onClick={() => handleManage(notif)}
                            className="text-xs font-semibold text-toon-blue hover:underline"
                          >
                            Manage user →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
