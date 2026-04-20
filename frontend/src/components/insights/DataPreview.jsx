import { motion } from 'framer-motion'
import { parseDataPreview } from './parsers'

export default function DataPreview({ content }) {
  const data = parseDataPreview(content)
  if (!data) return null
  const { kind, headers, rows } = data

  return (
    <div>
      <div className="text-xs uppercase tracking-wider font-bold text-gray-500 mb-3">
        Preview · first {rows.length} rows · {kind.toUpperCase()}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-emerald-500 to-teal-400 text-white">
              {headers.map(h => (
                <th key={h} className="text-left px-4 py-2 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <motion.tr
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: i * 0.07 }}
                className="border-t border-gray-100"
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-gray-700 truncate max-w-[200px]" title={cell}>{cell}</td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
