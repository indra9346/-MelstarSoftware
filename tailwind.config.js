/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1e2b5c', soft: '#55628f', faint: '#8a94b8' },
        brand: { cyan: '#06b6d4', indigo: '#6366f1', pink: '#ec4899' },
        surface: { DEFAULT: '#f4f7ff', 2: '#eaf0ff' },
        mint: '#10b981',
        amber: { DEFAULT: '#f59e0b' },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Space Grotesk"', '"Inter Variable"', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      borderRadius: { xl2: '22px' },
      boxShadow: {
        glass: '0 20px 60px -20px rgba(70, 90, 200, .28)',
        soft: '0 10px 30px -14px rgba(70, 90, 200, .30)',
        lift: '0 24px 50px -18px rgba(70, 90, 200, .38)',
        btn: '0 12px 30px -10px rgba(99, 102, 241, .6), inset 0 1px 0 rgba(255,255,255,.4)',
      },
      backgroundImage: {
        grad: 'linear-gradient(110deg, #06b6d4, #6366f1 50%, #ec4899)',
        'grad-ci': 'linear-gradient(135deg, #06b6d4, #6366f1)',
      },
      transitionTimingFunction: { brand: 'cubic-bezier(.22, 1, .36, 1)' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        ping2: { from: { transform: 'scale(.5)', opacity: '1' }, to: { transform: 'scale(2.2)', opacity: '0' } },
        beat: { '0%, 40%, 100%': { transform: 'scale(1)' }, '12%': { transform: 'scale(1.22)' }, '24%': { transform: 'scale(1.04)' }, '32%': { transform: 'scale(1.16)' } },
        gradShift: { to: { backgroundPosition: '200% center' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        ping2: 'ping2 1.8s ease-out infinite',
        beat: 'beat 1.6s ease-in-out infinite',
        gradShift: 'gradShift 6s linear infinite',
      },
      screens: { xs: '400px' },
    },
  },
  plugins: [],
}
