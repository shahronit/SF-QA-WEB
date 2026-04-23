/**
 * react-markdown custom `table` — wraps the table in a horizontal scroll
 * container so the parent can use overflow-y-only (long reports) without
 * stretching the whole panel width-wise.
 */
export default function MarkdownTableScroll({ children, ...props }) {
  return (
    <div className="table-wrap -mx-1 max-w-full">
      <table {...props}>{children}</table>
    </div>
  )
}
