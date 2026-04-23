import React from 'react'

const BR_PATTERN = /(?:&lt;|<)\s*br\s*\/?\s*(?:&gt;|>)/gi

const SENTINEL_PATTERN = /\\n|\|\|/g

const NUMBERED_INLINE_PATTERN = /\s+(?=\d+\.\s)/g

function hasInlineNumberedRun(value) {
  const matches = value.match(/(?:^|[^\d])(\d+)\.\s/g)
  return Array.isArray(matches) && matches.length >= 2
}

function normalizeCellString(value) {
  if (typeof value !== 'string' || value.length === 0) return value
  let next = value.replace(BR_PATTERN, '\n').replace(SENTINEL_PATTERN, '\n')
  if (!next.includes('\n') && hasInlineNumberedRun(next)) {
    next = next.replace(NUMBERED_INLINE_PATTERN, '\n')
  }
  return next
}

function splitChildren(children) {
  const arr = React.Children.toArray(children)
  const groups = [[]]

  const push = (node) => {
    groups[groups.length - 1].push(node)
  }
  const breakLine = () => {
    groups.push([])
  }

  arr.forEach((child, idx) => {
    if (typeof child === 'string') {
      const normalized = normalizeCellString(child)
      const parts = normalized.split('\n')
      parts.forEach((part, i) => {
        if (part.length > 0) push(part)
        if (i < parts.length - 1) breakLine()
      })
    } else if (React.isValidElement(child) && (child.type === 'br' || child.props?.node?.tagName === 'br')) {
      breakLine()
    } else if (React.isValidElement(child)) {
      push(React.cloneElement(child, { key: child.key ?? `c-${idx}` }))
    } else {
      push(child)
    }
  })

  return groups.filter((g) => g.length > 0)
}

export default function MarkdownTableCell({ children, node: _node, ...rest }) {
  const groups = splitChildren(children)

  if (groups.length <= 1) {
    return <td {...rest}>{children}</td>
  }

  return (
    <td {...rest}>
      {groups.map((group, i) => {
        const trimmedFirst = typeof group[0] === 'string' ? group[0].replace(/^\s+/, '') : group[0]
        const rendered = [trimmedFirst, ...group.slice(1)]
        return (
          <div key={i} className="md-cell-line">
            {rendered}
          </div>
        )
      })}
    </td>
  )
}
