import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies to the running service so the browser sees one
// origin and no CORS layer has to exist in the service just for this page.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://127.0.0.1:3000', '/healthz': 'http://127.0.0.1:3000' },
  },
  build: { outDir: 'dist' },
});
