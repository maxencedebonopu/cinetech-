import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, l'API tourne à part (npm start) ; Vite lui relaie /api et /images.
const api = process.env.API_URL ?? 'http://localhost:8765';

/** Écrit dist/sw.js à partir de sw-template.js avec la liste des fichiers du build (précache). */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'cine-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (!/^(sw\.js|\.cine-build)$/.test(e.name) && !e.name.endsWith('.woff')) files.push('/' + path.relative(outDir, p).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      // les .woff (anciens navigateurs) ne sont jamais chargés à côté des .woff2
      const assets = files.filter((f) => f.startsWith('/assets/')).sort().join('|');
      let h = 0; for (let i = 0; i < assets.length; i++) h = (h * 31 + assets.charCodeAt(i)) | 0;
      const precache = ['/index.html', ...files.filter((f) => f !== '/index.html')];
      const sw = fs.readFileSync(path.resolve(__dirname, 'sw-template.js'), 'utf8')
        .replace('__VERSION__', (h >>> 0).toString(36))
        .replace('__PRECACHE__', JSON.stringify(precache));
      fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { port: 5173, proxy: { '/api': api, '/images': api } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
