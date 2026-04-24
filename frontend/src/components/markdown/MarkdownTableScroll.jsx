import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * react-markdown custom `table` — wraps the table in a scroll container that
 * owns BOTH axes and is height-capped (see `.table-wrap` in toon-theme.css)
 * so the horizontal scrollbar stays inside the visible viewport even when
 * the ancestor panel is also scrolling.
 *
 * On top of that we render a sticky proxy scrollbar (`.table-wrap-top`)
 * mirroring the table width, kept in lockstep with the real bottom one via
 * `scroll` event listeners. This guarantees a horizontal bar at eye level
 * even when the table is tall enough that the bottom bar is below the fold.
 */
export default function MarkdownTableScroll({ children, ...props }) {
  const wrapRef = useRef(null)
  const topRef = useRef(null)
  const tableRef = useRef(null)
  const [tableWidth, setTableWidth] = useState(0)
  const [showTopBar, setShowTopBar] = useState(false)

  // Measure the underlying table so the proxy scroller has the right width.
  // ResizeObserver fires whenever the table reflows (e.g. fonts load, parent
  // resizes, content streams in mid-generation), keeping the proxy honest.
  useLayoutEffect(() => {
    if (!tableRef.current || !wrapRef.current) return
    const update = () => {
      if (!tableRef.current || !wrapRef.current) return
      const tw = tableRef.current.scrollWidth
      const ww = wrapRef.current.clientWidth
      setTableWidth(tw)
      setShowTopBar(tw > ww + 1)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(tableRef.current)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // Two-way sync between the proxy scrollbar and the real wrap. The
  // `syncing` flag prevents a feedback loop where each scroll handler
  // triggers the other.
  useEffect(() => {
    const wrap = wrapRef.current
    const top = topRef.current
    if (!wrap || !top || !showTopBar) return
    let syncing = false
    const onWrap = () => {
      if (syncing) return
      syncing = true
      top.scrollLeft = wrap.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }
    const onTop = () => {
      if (syncing) return
      syncing = true
      wrap.scrollLeft = top.scrollLeft
      requestAnimationFrame(() => { syncing = false })
    }
    wrap.addEventListener('scroll', onWrap, { passive: true })
    top.addEventListener('scroll', onTop, { passive: true })
    return () => {
      wrap.removeEventListener('scroll', onWrap)
      top.removeEventListener('scroll', onTop)
    }
  }, [showTopBar])

  return (
    <div ref={wrapRef} className="table-wrap -mx-1 max-w-full">
      {showTopBar && (
        <div ref={topRef} className="table-wrap-top" aria-hidden="true">
          <div style={{ width: tableWidth }} />
        </div>
      )}
      <table ref={tableRef} {...props}>{children}</table>
    </div>
  )
}
