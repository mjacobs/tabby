import { render } from 'preact';

// Phase 0 placeholder. The real settings form (DESIGN.md §2.7) lands in Phase 4.
function OptionsPlaceholder() {
  return (
    <main style={{ font: '14px system-ui', padding: '2rem', maxWidth: 720 }}>
      <h1 style={{ margin: '0 0 .25rem' }}>Tabby Settings</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Normalization rules, keep policy, and protections arrive in Phase 4.
      </p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<OptionsPlaceholder />, root);
