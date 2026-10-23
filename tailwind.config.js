/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // text
        ink: { DEFAULT: '#172033', soft: '#4a5468', faint: '#8a93a5' },
        // Melstar steel blue: the single accent colour (buttons, links, active nav, focus)
        brand: {
          50: '#eff4fb',
          100: '#dce6f5',
          200: '#bfd1ee',
          300: '#93b2e1',
          400: '#5f8acd',
          500: '#3d6cba',
          600: '#2a56a1',
          700: '#224584',
          800: '#1f3b6c',
          900: '#1c3259',
          950: '#121f39',
        },
        // page canvas and hairlines
        surface: { DEFAULT: '#f3f4f6', 2: '#e9ebef' },
        line: { DEFAULT: '#e1e4e9', strong: '#cdd2da' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', '"Cascadia Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, .05)',
        soft: '0 1px 3px rgba(16, 24, 40, .08), 0 1px 2px rgba(16, 24, 40, .04)',
        lift: '0 12px 28px -8px rgba(16, 24, 40, .18), 0 4px 8px -4px rgba(16, 24, 40, .08)',
      },
      transitionTimingFunction: { brand: 'cubic-bezier(.2, 0, 0, 1)' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
      screens: { xs: '400px' },
    },
  },
  plugins: [],
}
