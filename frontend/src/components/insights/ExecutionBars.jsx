import BarStat from '../motion/BarStat'
import Counter from '../motion/Counter'
import { parseExecutionMetrics } from './parsers'

export default function ExecutionBars({ content }) {
  const data = parseExecutionMetrics(content)
  if (!data) return null
  const { passed, failed, blocked, notRun, total } = data
  const passRate = total ? Math.round((passed / total) * 100) : 0

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Passed', value: passed, gradient: 'from-emerald-500 to-teal-400', emoji: '✅' },
          { label: 'Failed', value: failed, gradient: 'from-rose-500 to-red-400', emoji: '❌' },
          { label: 'Blocked', value: blocked, gradient: 'from-amber-500 to-yellow-400', emoji: '⛔' },
          { label: 'Not Run', value: notRun, gradient: 'from-gray-400 to-gray-300', emoji: '⏸' },
        ].map(t => (
          <div key={t.label} className={`p-3 rounded-2xl bg-gradient-to-br ${t.gradient} text-white shadow-toon`}>
            <div className="text-[11px] uppercase tracking-wider font-bold opacity-95">{t.emoji} {t.label}</div>
            <div className="text-2xl font-extrabold mt-1"><Counter to={t.value} /></div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <BarStat label="Passed" value={passed} total={total} gradient="from-emerald-500 to-teal-400" delay={0.05} highlight={passRate >= 90} badge={passRate >= 90 ? 'Healthy' : null} />
        <BarStat label="Failed" value={failed} total={total} gradient="from-rose-500 to-red-400" delay={0.15} />
        <BarStat label="Blocked" value={blocked} total={total} gradient="from-amber-500 to-yellow-400" delay={0.25} />
        <BarStat label="Not Run" value={notRun} total={total} gradient="from-gray-400 to-gray-300" delay={0.35} />
      </div>
      <div className="mt-5 p-4 rounded-2xl bg-gradient-to-r from-toon-blue/10 to-transparent">
        <div className="text-xs uppercase tracking-wider font-bold text-gray-500">Overall pass rate</div>
        <div className="text-3xl font-extrabold text-toon-navy mt-1">
          <Counter to={passRate} suffix="%" />
        </div>
      </div>
    </div>
  )
}
