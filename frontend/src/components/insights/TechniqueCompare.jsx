import BarStat from '../motion/BarStat'
import { parseTechniques } from './parsers'

export default function TechniqueCompare({ content }) {
  const data = parseTechniques(content)
  if (!data) return null
  const max = Math.max(...data.items.map(i => i.value), 1)
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-2">Techniques Compared</div>
      {data.items.map((row, idx) => {
        const isRec = data.recommended && row.name.toLowerCase().includes(data.recommended.split(' ')[0])
        return (
          <BarStat
            key={row.name}
            label={`${row.name} (${row.unit})`}
            value={row.value}
            total={max}
            gradient={isRec ? 'from-amber-500 to-yellow-400' : 'from-toon-purple to-violet-400'}
            delay={idx * 0.07}
            highlight={isRec}
            badge={isRec ? 'Recommended' : null}
          />
        )
      })}
    </div>
  )
}
