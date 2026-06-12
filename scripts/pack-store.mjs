// Build the Chrome Web Store upload ZIP from dist/.
//
// The dev manifest pins a "key" so load-unpacked installs keep a stable
// extension ID (storage survives reloads), but the store signs uploads with
// its own key and a pinned one must not ship (CHROMEWEBSTORE.md §1.4). This
// strips "key" from dist/manifest.json, zips dist/ into tabby-extension.zip,
// then restores the manifest so the local unpacked install keeps its ID.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const manifestPath = 'dist/manifest.json';
const original = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(original);

if (!('key' in manifest)) {
  console.warn('pack-store: dist manifest has no "key" — packing as-is');
}
delete manifest.key;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

try {
  rmSync('tabby-extension.zip', { force: true });
  execSync('zip -qr ../tabby-extension.zip .', { cwd: 'dist', stdio: 'inherit' });
} finally {
  writeFileSync(manifestPath, original);
}
console.log('pack-store: wrote tabby-extension.zip ("key" stripped from its manifest)');
