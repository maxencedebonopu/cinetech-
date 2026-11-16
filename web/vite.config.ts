import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, l'API tourne à part (npm start) ; Vite lui relaie /api et /images.
const api = process.env.API_URL ?? 'http://localhost:8765';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': api, '/images': api } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
