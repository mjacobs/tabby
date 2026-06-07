import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Tabby',
  version: pkg.version,
  description: pkg.description,
  icons: {
    16: 'src/icons/icon16.png',
    32: 'src/icons/icon32.png',
    48: 'src/icons/icon48.png',
    128: 'src/icons/icon128.png',
  },
  // Clicking the toolbar icon runs the cleanup pipeline (handled in background).
  action: {
    default_title: 'Tabby: clean up tabs',
    default_icon: {
      16: 'src/icons/icon16.png',
      32: 'src/icons/icon32.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/options.html',
  permissions: ['tabs', 'tabGroups', 'storage', 'sessions'],
  optional_permissions: ['sidePanel'],
  web_accessible_resources: [
    {
      resources: ['src/review/review.html'],
      matches: ['<all_urls>'],
    },
  ],
  commands: {
    'run-cleanup': {
      suggested_key: {
        default: 'Ctrl+Shift+K',
        mac: 'Command+Shift+K',
      },
      description: 'Consolidate, dedup, sort, and review tabs',
    },
  },
});
