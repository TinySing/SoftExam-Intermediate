import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: Number(process.env.VITE_PORT || 4321),
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
