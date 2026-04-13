export default function ProjectBar({ project }) {
  if (!project) return null
  return (
    <div className="flex items-center gap-2 bg-toon-blue/5 border border-toon-blue/15 rounded-2xl px-4 py-2.5 mb-4">
      <span className="text-lg">📂</span>
      <span className="font-bold text-toon-navy text-sm">{project.name}</span>
      <span className="text-xs text-gray-400 ml-auto">{project.docs || 0} docs</span>
    </div>
  )
}
