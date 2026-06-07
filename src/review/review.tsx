import { render } from 'preact';

// Phase 0 placeholder. The host-agnostic ReviewView + keyboard interface lands
// in Phase 3 (see DESIGN.md §2.5 / §3.4). This shell is `shells/page` in spirit.
function ReviewPlaceholder() {
  return (
    <main style={{ font: '14px system-ui', padding: '2rem', maxWidth: 720 }}>
      <h1 style={{ margin: '0 0 .25rem' }}>Tabby</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Scaffold is live. The keyboard-driven review list arrives in Phase 3.
      </p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<ReviewPlaceholder />, root);
