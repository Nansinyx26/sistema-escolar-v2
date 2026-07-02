/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./js/**/*.js",
    "./admin/**/*.html",
    "./direcao/**/*.html",
    "./detalhes/**/*.html",
    "./utils/**/*.html",
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
