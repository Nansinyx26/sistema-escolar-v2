import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
          @import "@/styles/_variables.scss";
          @import "@/styles/_mixins.scss";
        `,
      },
    },
  },
  server: {
    port: 5174,
    open: true,
    fs: {
      // O portal reaproveita o sistema de motion da raiz do repositório
      // (css/motion.css e js/motion.js), que fica fora da root do Vite.
      // Sem isso o dev server bloqueia a leitura desses arquivos.
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
