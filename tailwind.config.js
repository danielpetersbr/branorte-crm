// `tailwindcss-animate` fornece animate-in/fade-in-0/zoom-in-95/slide-in-from-*, que os
// componentes Radix de `src/components/pedido-ui/` usam pra entrar e sair. Sem o plugin
// as classes nao existem: o dialog aparece estalado, sem transicao (e sem erro nenhum).
import animate from 'tailwindcss-animate'

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
          // bg-surface-3 tem 101 usos no src e o token NAO existia: o Tailwind
          // descartava a classe em silencio e o elemento ficava sem fundo nenhum.
          3: 'hsl(var(--surface-3) / <alpha-value>)',
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
        // Serie de grafico — usar SEMPRE estes, nunca hsl() literal no JSX.
        // Apontam pros semanticos calibrados, entao seguem o tema.
        // Texto sobre bg-accent (botao cheio). Sem isto o codigo usava
        // text-white cru em 6 arquivos e mudar o verde nao avisava ninguem.
        'accent-fg': 'hsl(var(--accent-fg) / <alpha-value>)',
        // Veu de modal — preto puro serve aos dois temas (ver index.css).
        overlay: 'hsl(var(--overlay) / <alpha-value>)',
        chart: {
          1: 'hsl(var(--chart-1) / <alpha-value>)',
          2: 'hsl(var(--chart-2) / <alpha-value>)',
          3: 'hsl(var(--chart-3) / <alpha-value>)',
          4: 'hsl(var(--chart-4) / <alpha-value>)',
          5: 'hsl(var(--chart-5) / <alpha-value>)',
          grid: 'hsl(var(--chart-grid) / <alpha-value>)',
          ink: 'hsl(var(--chart-ink) / <alpha-value>)',
        },
        // ── Vocabulario shadcn/ui, usado SO pelos componentes de `pedido-ui/` ──
        // Esses componentes vieram de controle.branorte.com junto com o subsistema de
        // Pedido de Venda. Eles falam o dialeto do shadcn (bg-background, text-muted-
        // foreground, border-input...), que nao existia aqui: sem estes aliases o
        // Tailwind DESCARTA a classe em silencio e o dialog/popover sai transparente —
        // o mesmo modo de falha ja documentado no `surface-3` la em cima.
        //
        // Cada um aponta pras CSS vars que o CRM ja tem, entao o que foi portado herda
        // o tema do CRM (claro E escuro) em vez de trazer um segundo tema junto.
        //
        // ⚠️ `accent` NAO esta nesta lista de proposito. Aqui `accent` e o verde da
        // marca (110 arquivos usam `bg-accent`); no shadcn `accent` e o cinza de hover
        // de item de menu. Redefinir pintaria o app inteiro de verde errado, entao os
        // arquivos portados usam `pvhover` (logo abaixo) no lugar.
        background: 'hsl(var(--bg) / <alpha-value>)',
        foreground: 'hsl(var(--ink) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          foreground: 'hsl(var(--ink) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          foreground: 'hsl(var(--ink) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--surface-2) / <alpha-value>)',
          foreground: 'hsl(var(--ink) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--surface-2) / <alpha-value>)',
          foreground: 'hsl(var(--ink-muted) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        input: 'hsl(var(--border) / <alpha-value>)',
        ring: 'hsl(var(--accent) / <alpha-value>)',
        // Hover/estado ativo de item de lista (o que o shadcn chamaria de `accent`).
        pvhover: {
          DEFAULT: 'hsl(var(--surface-2) / <alpha-value>)',
          foreground: 'hsl(var(--ink) / <alpha-value>)',
        },
        // Brand kept for backwards compat
        brand: {
          50:  'hsl(152 70% 96%)',
          100: 'hsl(152 60% 90%)',
          200: 'hsl(152 60% 80%)',
          // NAO alinhar ao --accent. `brand-*` e paleta ESTATICA (legado, sem
          // variante .dark), entao escurecer pro tema claro escurece o escuro
          // junto: o spinner do app inteiro (LoadingSpinner.tsx:7) caia de
          // 4,36:1 pra 3,06:1 no escuro, e o checkbox marcado da /assign de
          // 5,42 pra 3,27. Quem precisa de verde com os dois temas usa
          // `accent`, que tem valor no .dark. Valores originais restaurados.
          500: 'hsl(152 60% 45%)',
          600: 'hsl(152 60% 40%)',
          700: 'hsl(152 60% 32%)',
          800: 'hsl(152 60% 25%)',
          900: 'hsl(152 60% 18%)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'SF Pro Text', 'Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Cascadia Code', 'Roboto Mono', 'monospace'],
      },
      // Escala tipografica do dashboard — 6 degraus, piso 12px.
      // A tela antiga tinha 26 tamanhos distintos, 191 deles abaixo de 12px.
      fontSize: {
        kpi:      ['32px', { lineHeight: '1.05', fontWeight: '600', letterSpacing: '-0.02em' }],
        'kpi-sm': ['22px', { lineHeight: '1.1',  fontWeight: '600', letterSpacing: '-0.015em' }],
        title:    ['15px', { lineHeight: '1.35', fontWeight: '600', letterSpacing: '-0.01em' }],
        body:     ['14px', { lineHeight: '1.5',  fontWeight: '400' }],
        label:    ['13px', { lineHeight: '1.4',  fontWeight: '500' }],
        micro:    ['12px', { lineHeight: '1.35', fontWeight: '500' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
      // Safe-area utilities pra iOS (notch/home bar)
      // Uso: pb-safe, pt-safe, pl-safe, pr-safe, h-safe-screen
      spacing: {
        safe: 'env(safe-area-inset-bottom)',
        'safe-top': 'env(safe-area-inset-top)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      maxHeight: {
        'dvh': '100dvh',
        'dvh-safe': 'calc(100dvh - env(safe-area-inset-bottom))',
      },
    },
  },
  plugins: [
    animate,
    // Utilitarios pb-safe / pt-safe / pl-safe / pr-safe
    function ({ addUtilities }) {
      addUtilities({
        '.pb-safe': { paddingBottom: 'env(safe-area-inset-bottom)' },
        '.pt-safe': { paddingTop: 'env(safe-area-inset-top)' },
        '.pl-safe': { paddingLeft: 'env(safe-area-inset-left)' },
        '.pr-safe': { paddingRight: 'env(safe-area-inset-right)' },
        '.mb-safe': { marginBottom: 'env(safe-area-inset-bottom)' },
        '.mt-safe': { marginTop: 'env(safe-area-inset-top)' },
        '.bottom-safe': { bottom: 'env(safe-area-inset-bottom)' },
        // Rolagem horizontal DENTRO de um componente (abas, chips) sem barra
        // visivel. A pagina em si nunca rola na horizontal.
        '.scrollbar-none': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      })
    },
  ],
}
