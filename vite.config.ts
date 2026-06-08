import { fileURLToPath, URL } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // The review page is opened dynamically (chrome.tabs.create), so it isn't
      // referenced by the manifest and must be declared as an explicit input.
      input: {
        review: fileURLToPath(new URL('./src/review/review.html', import.meta.url)),
      },
    },
  },
  // crxjs needs a stable HMR port for the service worker / content scripts.
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
