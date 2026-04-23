/**
 * Best-effort slice of a requirements-analysis markdown that contains
 * "Clarifying Questions" (or similar). Returns '' if no such section is found.
 */
export function extractClarificationBlock(md) {
  if (!md || !String(md).trim()) return ''
  let s = String(md)
  if (s.startsWith('---')) {
    const end = s.indexOf('\n---\n', 3)
    if (end !== -1) s = s.slice(end + 5)
  }
  const lines = s.split(/\r?\n/)
  // Heading line that mentions clarifying / open questions
  const headingRe = /^#{1,6}\s+.*(clarif|open\s+clarif)/i
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i].trim())) {
      start = i
      break
    }
  }
  if (start < 0) return ''
  const m = lines[start].match(/^(#+)\s/)
  const level = m ? m[1].length : 1
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{1,6})\s/)
    if (hm && hm[1].length <= level) break
    out.push(lines[i])
  }
  return out.join('\n').trim()
}
