import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  // Pins a stable extension ID so chrome.storage.sync (settings) survives
  // remove/re-add of the unpacked dev build. Public half of an RSA keypair;
  // private key is tabby-extension-key.pem (gitignored).
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8uKdKGYKBUnxtPDnefuYmjVFT57C/1TxwY5vMiYq7gcbmzFwQdpOwebd5UTmRFBBN4WHADNYv/WYTcQWrDRrPIuYCIgdP41qSxW+PU5+EQBDJ4oBVOD0xxEP3j7MBiViihfFIxR3H2Rgm7oq1DlU9RcAZ+ffpRN5pEkyFkrAD4b+a81tEwtoe36V7EqTbJ1reU89Yq6P+H330Erd02qdX7M6nZUG/zh2W6S6L30ASvcQAvs7F9H1U1CWPXUzfPl8dirOb4VIOTz62zj7V6+x8dsWDugAaKQDrQlv6at4CnqzhvgzVGEjlrSmHvtymbVyQada7q8RFyraNbqowAQeyQIDAQAB',
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
  permissions: ['tabs', 'tabGroups', 'storage', 'sessions', 'bookmarks'],
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
