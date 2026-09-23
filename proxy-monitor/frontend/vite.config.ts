import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  // Ingress assigns a different, unpredictable path to each installation.
  base: './',
  build: { outDir: '../src/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8099',
      '/ws': { target: 'ws://127.0.0.1:8099', ws: true },
    },
  },
});
