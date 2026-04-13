import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto relative">
        <div className="toon-blob w-96 h-96 bg-toon-blue -top-20 -right-20 fixed" />
        <div className="toon-blob w-72 h-72 bg-toon-coral bottom-10 -left-10 fixed" />
        <div className="relative z-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
