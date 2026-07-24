/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./js/**/*.js",
    // html/** é onde vive a maioria das páginas (dashboard, selecionar,
    // secretaria/*, direcao/*, admin/*) — sem esta linha, classes Tailwind
    // usadas só nelas eram purgadas silenciosamente do build.
    "./html/**/*.html",
    "./direcao/**/*.html",
    "./detalhes/**/*.html",
    "./graficos/**/*.html",
  ],
  theme: {
    extend: {},
  },
  // daisyUI convive com o design system custom (que já define .btn, .card,
  // .modal, etc.) graças ao prefixo dui-. Use `dui-btn dui-btn-primary`,
  // `dui-card`, `dui-badge`… nas telas novas sem afetar as antigas.
  plugins: [require('daisyui')],
  daisyui: {
    prefix: 'dui-',
    base: false,   // não injeta estilos globais em html/body (evita conflito)
    logs: false,
    themes: [
      {
        // Tema claro — verde institucional (esmeralda + teal)
        escolar: {
          'primary': '#10b981',
          'primary-content': '#ffffff',
          'secondary': '#0d9488',
          'secondary-content': '#ffffff',
          'accent': '#14b8a6',
          'accent-content': '#ffffff',
          'neutral': '#1f2937',
          'neutral-content': '#f3f4f6',
          'base-100': '#ffffff',
          'base-200': '#f0fdf9',
          'base-300': '#d1fae5',
          'base-content': '#0f2e26',
          'info': '#0ea5e9',
          'success': '#10b981',
          'warning': '#f59e0b',
          'error': '#ef4444',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.65rem',
        },
      },
      {
        // Tema escuro — casa com data-theme="dark" das páginas
        'escolar-dark': {
          'primary': '#10b981',
          'primary-content': '#052e22',
          'secondary': '#2dd4bf',
          'secondary-content': '#042f2a',
          'accent': '#5eead4',
          'accent-content': '#042f2a',
          'neutral': '#111c1a',
          'neutral-content': '#d1fae5',
          'base-100': '#0b1512',
          'base-200': '#0f1f1a',
          'base-300': '#16302a',
          'base-content': '#d1fae5',
          'info': '#38bdf8',
          'success': '#34d399',
          'warning': '#fbbf24',
          'error': '#f87171',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.65rem',
        },
      },
    ],
    darkTheme: 'escolar-dark',
  },
  corePlugins: {
    preflight: false,
  }
}
