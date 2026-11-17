import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  server: { host: '127.0.0.1', hmr: mode !== 'nohmr' },
}));
