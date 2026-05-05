import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseDefectReport } from '../utils/parseDefectReport'

/**
 * Reusable Jira-style Description body. Renders the four Pentair
 * sub-sections (Steps to reproduce, Actual results, Expected results,
 * optional Additional information) in the exact order Jira shows them
 * inside a real ticket. Used by:
 *   - DefectReportCard below (the Defect Report agent's main view).
 *   - JiraBugPush's live preview panel (so the user sees what they will
 *     push before they push it).
 *
 * `description` is the parsed envelope from parseDefectReport, i.e.
 * `{ steps: string[], expected: string, actual: string, additional: string }`.
 * Empty fields are skipped silently so the layout stays tight when an
 * agent omitted (or the user cleared) a sub-section.
 */
export function DescriptionBody({ description }) {
  if (!description) return null
  const hasAny =
    (description.steps && description.steps.length > 0) ||
    description.expected ||
    description.actual ||
    description.additional
  if (!hasAny) return null
  return (
    <div className="space-y-4 text-[14px] leading-relaxed text-toon-navy">
      {description.steps && description.steps.length > 0 && (
        <div>
          <div className="font-extrabold text-toon-navy mb-1.5">
            Steps to reproduce:
          </div>
          <ol className="list-decimal pl-6 space-y-1">
            {description.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {description.actual && (
        <div>
          <div className="font-extrabold text-toon-navy mb-1.5">
            Actual results:
          </div>
          <ul className="list-disc pl-6 space-y-1 whitespace-pre-line">
            {description.actual.split(/\r?\n/).filter(Boolean).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {description.expected && (
        <div>
          <div className="font-extrabold text-toon-navy mb-1.5">
            Expected results:
          </div>
          <ul className="list-disc pl-6 space-y-1 whitespace-pre-line">
            {description.expected.split(/\r?\n/).filter(Boolean).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {description.additional && (
        <div>
          <div className="font-extrabold text-toon-navy mb-1.5">
            Additional information:
          </div>
          <ul className="list-disc pl-6 space-y-1 whitespace-pre-line">
            {description.additional.split(/\r?\n/).filter(Boolean).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Defect Report Card — the only thing the bug_report agent renders in
 * the Formatted view. Mirrors the Jira ticket layout from the design
 * reference: bold title at the top and a single collapsible Description
 * section below containing Steps / Actual / Expected / Additional.
 *
 * Metadata (Priority, Severity, Component, Labels, Linked Story, etc.)
 * is intentionally NOT shown here even though parseDefectReport extracts
 * it. The values flow silently into the Jira push modal's editable form
 * fields and onto real Jira REST fields when the user pushes the bug,
 * which keeps the report panel as clean as a real Jira ticket page.
 */
export default function DefectReportCard({ markdown }) {
  const parsed = useMemo(() => parseDefectReport(markdown || ''), [markdown])
  const [open, setOpen] = useState(true)

  if (!parsed.title && (!parsed.description || parsed.description.steps.length === 0)) {
    // Stream still warming up or output is empty — nothing to show yet.
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5"
    >
      <h2 className="text-[20px] sm:text-[22px] font-extrabold text-toon-navy leading-snug break-words">
        {parsed.title || 'Untitled defect'}
      </h2>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-[13px] font-extrabold text-toon-navy hover:text-toon-blue transition-colors"
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.18 }}
            className="inline-block text-gray-400"
            aria-hidden="true"
          >
            ▸
          </motion.span>
          Description
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="desc"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-3">
                <DescriptionBody description={parsed.description} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
