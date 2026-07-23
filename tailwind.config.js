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
  plugins: [],
  corePlugins: {
    preflight: false,
  }
}
