export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        toon: {
          blue: '#38BDF8',
          coral: '#F87171',
          mint: '#34D399',
          yellow: '#FBBF24',
          purple: '#A78BFA',
          cream: '#FFF8F0',
          navy: '#1E3A5F',
          dark: '#2D3748',
        },
        // Astound co-brand palette — modern dark-mode SaaS feel,
        // layered alongside the toon palette so legacy components
        // keep rendering while pages are migrated.
        astound: {
          deep:    '#0F0E1A', // near-black hero surfaces
          surface: '#1A1830', // raised cards on dark
          violet:  '#7B61FF', // primary brand accent
          magenta: '#FF3D8B', // secondary accent / sparkle
          cyan:    '#43E5F4', // tertiary glow
          cream:   '#F8F7FF', // light surface tint
          mist:    '#EEEAFB', // subtle hover wash
          ink:     '#13112B', // copy on light surfaces
        },
      },
      fontFamily: {
        toon: ['Nunito', 'sans-serif'],
        // Display font for Astound headlines, body font for prose.
        display: ['Sora', 'Nunito', 'sans-serif'],
        astound: ['Inter', 'Nunito', 'sans-serif'],
      },
      borderRadius: {
        'toon': '20px',
        'toon-lg': '28px',
      },
      boxShadow: {
        'toon': '0 8px 30px rgba(56, 189, 248, 0.15)',
        'toon-coral': '0 8px 30px rgba(248, 113, 113, 0.15)',
        'toon-mint': '0 8px 30px rgba(52, 211, 153, 0.15)',
        'toon-purple': '0 8px 30px rgba(167, 139, 250, 0.15)',
        'toon-yellow': '0 8px 30px rgba(251, 191, 36, 0.15)',
        // Soft halo for Astound hero buttons / 3D icon cards.
        'astound':       '0 20px 60px -20px rgba(123, 97, 255, 0.45)',
        'astound-glow':  '0 0 40px rgba(123, 97, 255, 0.35)',
        'astound-card':  '0 24px 70px -28px rgba(15, 14, 26, 0.35)',
      },
      backgroundImage: {
        // Single source of truth for the brand gradient — used by
        // hero CTAs, active nav highlights, badge accents.
        'astound-grad': 'linear-gradient(135deg, #7B61FF 0%, #FF3D8B 55%, #43E5F4 100%)',
        'astound-grad-soft': 'linear-gradient(135deg, rgba(123,97,255,0.18), rgba(255,61,139,0.18) 55%, rgba(67,229,244,0.18))',
        // Aurora-mesh background used by AuroraBg component as a
        // static fallback when prefers-reduced-motion is set.
        'astound-aurora': 'radial-gradient(at 20% 20%, rgba(123,97,255,0.55) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(255,61,139,0.45) 0px, transparent 50%), radial-gradient(at 50% 90%, rgba(67,229,244,0.35) 0px, transparent 55%)',
      },
      keyframes: {
        'aurora-spin': {
          '0%':   { transform: 'rotate(0deg) scale(1)' },
          '50%':  { transform: 'rotate(180deg) scale(1.05)' },
          '100%': { transform: 'rotate(360deg) scale(1)' },
        },
        'sparkle-rise': {
          '0%':   { opacity: '0', transform: 'translateY(8px) scale(0.6)' },
          '50%':  { opacity: '1', transform: 'translateY(-2px) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-12px) scale(0.6)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'aurora-spin':    'aurora-spin 28s linear infinite',
        'sparkle-rise':   'sparkle-rise 2.4s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 6s ease infinite',
      },
    },
  },
  plugins: [],
}
