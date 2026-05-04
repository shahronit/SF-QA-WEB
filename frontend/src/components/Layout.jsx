import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import RouteTransition from './motion/RouteTransition'
import AuroraBg from './motion/AuroraBg'
import QdecFooter from './QdecFooter'
import AdminNotificationsBell from './AdminNotificationsBell'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { user } = useAuth()
  return (
    <div className="flex min-h-screen relative">
      {/* Subtle Astound aurora behind the entire app — kept low-opacity so
          it never competes with content. Sits behind the sidebar + main. */}
      <AuroraBg intensity="soft" fixed />

      <Sidebar />
      <main className="flex-1 overflow-auto relative z-[1]">
        {/* Legacy toon blobs preserved as a soft accent on the cream
            surface; they fade naturally against the new aurora layer. */}
        <div className="toon-blob w-96 h-96 bg-toon-blue -top-20 -right-20 fixed" />
        <div className="toon-blob w-72 h-72 bg-toon-coral bottom-10 -left-10 fixed" />
        <div className="relative z-10 flex flex-col min-h-screen">
          <div className="flex-1 p-8">
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </div>
          <QdecFooter />
        </div>
      </main>

      {/* Admin-only notifications bell — fixed in the top-right of the
          viewport so it's always reachable regardless of which page is
          open or how the sidebar is scrolled. Renders nothing for non-
          admins, so the corner is empty for regular users. Mounted at
          the Layout root (outside RouteTransition) so its dropdown
          anchors against the viewport, not a transformed ancestor. */}
      {user?.is_admin && (
        <div className="fixed top-4 right-4 z-[55]">
          <div className="rounded-full bg-white/90 backdrop-blur-md shadow-astound-card border border-astound-violet/20">
            <AdminNotificationsBell user={user} />
          </div>
        </div>
      )}
    </div>
  )
}
