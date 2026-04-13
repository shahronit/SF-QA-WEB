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
        }
      },
      fontFamily: {
        toon: ['Nunito', 'sans-serif'],
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
      },
    },
  },
  plugins: [],
}
