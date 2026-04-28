/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // HSL semantic tokens (CSS vars)
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          2: 'hsl(var(--surface-2) / <alpha-value>)',
          // legacy aliases
          secondary: 'hsl(var(--surface) / <alpha-value>)',
          tertiary: 'hsl(var(--surface-2) / <alpha-value>)',
          border: 'hsl(var(--border) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'hsl(var(--ink) / <alpha-value>)',
          muted: 'hsl(var(--ink-muted) / <alpha-value>)',
          faint: 'hsl(var(--ink-faint) / <alpha-value>)',
        },
        text: {
          primary: 'hsl(var(--ink) / <alpha-value>)',
          secondary: 'hsl(var(--ink-muted) / <alpha-value>)',
          muted: 'hsl(var(--ink-faint) / <alpha-value>)',
          tertiary: 'hsl(var(--ink-faint) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          bg: 'hsl(var(--success-bg) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          bg: 'hsl(var(--warning-bg) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          bg: 'hsl(var(--danger-bg) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          bg: 'hsl(var(--info-bg) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          bg: 'hsl(var(--accent-bg) / <alpha-value>)',
        },
        // Brand kept for backwards compat
        brand: {
          50:  'hsl(152 70% 96%)',
          100: 'hsl(152 60% 90%)',
          200: 'hsl(152 60% 80%)',
          500: 'hsl(152 60% 45%)',
          600: 'hsl(152 60% 40%)',
          700: 'hsl(152 60% 32%)',
          800: 'hsl(152 60% 25%)',
          900: 'hsl(152 60% 18%)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
}
