import Icon3D from './icons/Icon3D'

/**
 * Tiny center-aligned attribution strip — sparkle dot + the QDEC byline +
 * current year. Mirrors the reference portal's "Curated & Managed by DRT
 * Team" footer so every page surface ends with a clear ownership line.
 *
 * Variants
 * --------
 * - 'light' (default): authenticated app surfaces (Layout main area).
 * - 'dark'           : Login portal hero footer over the Astound surface.
 */
export default function QdecFooter({ variant = 'light', className = '' }) {
  const isDark = variant === 'dark'
  const baseColor = isDark ? 'text-white/70' : 'text-slate-500'

  return (
    <footer
      className={`flex items-center justify-center gap-2 py-3 text-xs ${baseColor} ${className}`}
      aria-label="Created and managed by QDEC Team"
    >
      <Icon3D name="sparkles" size={14} float />
      <span className="font-medium tracking-wide">
        Created &amp; Managed by{' '}
        <span className="astound-text-grad font-bold">QDEC Team</span>
      </span>
      <span className={`opacity-60 ${isDark ? '' : 'text-slate-400'}`}>
        · {new Date().getFullYear()}
      </span>
    </footer>
  )
}
