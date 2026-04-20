function pickNumber(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''))
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

export function parseExecutionMetrics(md) {
  if (!md) return null
  const lower = md.toLowerCase()
  const passed = pickNumber(lower, [/passed[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i, /\bpassed\b[^\d]*?(\d[\d,]*)/i])
  const failed = pickNumber(lower, [/failed[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i, /\bfailed\b[^\d]*?(\d[\d,]*)/i])
  const blocked = pickNumber(lower, [/blocked[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i, /\bblocked\b[^\d]*?(\d[\d,]*)/i])
  const notRun = pickNumber(lower, [/not\s*run[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i, /not\s*executed[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i, /\bnot\s*run\b[^\d]*?(\d[\d,]*)/i])
  if (passed == null && failed == null && blocked == null && notRun == null) return null
  const data = {
    passed: passed || 0,
    failed: failed || 0,
    blocked: blocked || 0,
    notRun: notRun || 0,
  }
  data.total = data.passed + data.failed + data.blocked + data.notRun
  return data
}

export function parseCoverage(md) {
  if (!md) return null
  const covered = pickNumber(md, [/covered[^\d]*?(\d{1,3})\s*%/i, /coverage[^\d]*?(\d{1,3})\s*%/i, /covered[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i])
  const partial = pickNumber(md, [/partial[^\d]*?(\d{1,3})\s*%/i, /partially\s*covered[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i])
  const notCovered = pickNumber(md, [/not\s*covered[^\d]*?(\d{1,3})\s*%/i, /uncovered[^\d]*?(\d{1,3})\s*%/i, /not\s*covered[^|\d]*[:\|][^\d]*?(\d[\d,]*)/i])
  if (covered == null && partial == null && notCovered == null) return null
  return {
    covered: covered || 0,
    partial: partial || 0,
    notCovered: notCovered != null ? notCovered : Math.max(0, 100 - (covered || 0) - (partial || 0)),
  }
}

const TECHNIQUE_NAMES = [
  'Work Breakdown',
  'Three-Point',
  'Function Point',
  'Use-Case Point',
  'Ratio',
  'Delphi',
  'Wideband',
  'Top-Down',
  'Bottom-Up',
  'PERT',
]

export function parseTechniques(md) {
  if (!md) return null
  const out = []
  TECHNIQUE_NAMES.forEach(name => {
    const re = new RegExp(`${name}[^\\n|]*[\\|: ]\\s*(\\d[\\d,.]*)\\s*(hr|hour|hrs|h|day|days|d)?`, 'i')
    const m = md.match(re)
    if (m) {
      const value = parseFloat(m[1].replace(/,/g, ''))
      if (!Number.isNaN(value)) {
        out.push({ name, value, unit: (m[2] || 'hrs').toLowerCase() })
      }
    }
  })
  if (out.length < 2) return null
  const recRe = /recommend(?:ed|ation)?[^\n]*?(work\s*breakdown|three[-\s]?point|function\s*point|use[-\s]?case\s*point|ratio|delphi|wideband|top[-\s]?down|bottom[-\s]?up|pert)/i
  const recMatch = md.match(recRe)
  let recommended = null
  if (recMatch) {
    recommended = recMatch[1].toLowerCase().replace(/\s+/g, ' ').trim()
  }
  return { items: out, recommended }
}

export function parseClosureKpi(md) {
  if (!md) return null
  const passRate = pickNumber(md, [/pass\s*rate[^\d]*?(\d{1,3}(?:\.\d+)?)\s*%/i])
  const defectsClosed = pickNumber(md, [/defects?\s*closed[^\d]*?(\d[\d,]*)/i, /closed\s*defects?[^\d]*?(\d[\d,]*)/i])
  const defectsOpen = pickNumber(md, [/(?:open|outstanding)\s*defects?[^\d]*?(\d[\d,]*)/i])
  const automationPct = pickNumber(md, [/automat\w*[^\d]*?(\d{1,3}(?:\.\d+)?)\s*%/i])
  const effortHrs = pickNumber(md, [/effort[^\d]*?(\d[\d,.]*)\s*(?:hr|hour|hrs)/i, /actual\s*effort[^\d]*?(\d[\d,.]*)/i])
  if (passRate == null && defectsClosed == null && automationPct == null && effortHrs == null && defectsOpen == null) return null
  return {
    passRate: passRate ?? null,
    defectsClosed: defectsClosed ?? null,
    defectsOpen: defectsOpen ?? null,
    automationPct: automationPct ?? null,
    effortHrs: effortHrs ?? null,
  }
}

export function parseDataPreview(md) {
  if (!md) return null
  const codeBlocks = [...md.matchAll(/```(\w+)?\n([\s\S]*?)```/g)]
  for (const block of codeBlocks) {
    const lang = (block[1] || '').toLowerCase()
    const body = block[2].trim()
    if (lang === 'csv' || (!lang && /,/.test(body.split('\n')[0] || ''))) {
      const rows = body.split(/\r?\n/).filter(Boolean).slice(0, 6)
      if (rows.length >= 2) {
        const headers = rows[0].split(',').map(s => s.trim())
        const data = rows.slice(1).map(r => r.split(',').map(s => s.trim()))
        return { kind: 'csv', headers, rows: data }
      }
    }
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(body)
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : null
        if (arr && arr.length) {
          const headers = Object.keys(arr[0])
          const rows = arr.slice(0, 5).map(o => headers.map(h => String(o[h] ?? '')))
          return { kind: 'json', headers, rows }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

export function buildSparklineFromText(md, points = 24) {
  if (!md) return []
  const len = md.length
  const seg = Math.max(1, Math.floor(len / points))
  const out = []
  for (let i = 0; i < points; i++) {
    const slice = md.slice(i * seg, (i + 1) * seg)
    out.push(slice.split(/\s+/).length)
  }
  return out
}
