import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { sendRequest, type ReviewState } from '@/shared/messages';

// Phase 2 summary view. It reads the stashed cleanup result to prove the
// pipeline end-to-end (snapshot → plan → execute → stash → render). The
// keyboard-driven keep/remove list replaces this in Phase 3.
function Review() {
  const [state, setState] = useState<ReviewState | null | undefined>(undefined);

  useEffect(() => {
    sendRequest({ type: 'getReview' }).then(setState, () => setState(null));
  }, []);

  if (state === undefined) return <Shell>Loading…</Shell>;
  if (state === null) {
    return <Shell>No cleanup has run yet. Click the Tabby icon to start.</Shell>;
  }

  return (
    <Shell>
      <p style={{ color: '#666', marginTop: 0 }}>
        {state.reviewTabs.length} tabs · {state.closedCount} closed ·{' '}
        {state.emptyWindowIds.length} empty window(s) ·{' '}
        {state.stayingPinnedTabIds.length} pinned left in place
      </p>
      <ol style={{ lineHeight: 1.6, paddingLeft: '1.25rem' }}>
        {state.reviewTabs.map((t) => (
          <li key={t.id}>
            <span style={{ color: '#888' }}>{hostOf(t.url)}</span> {t.title}
          </li>
        ))}
      </ol>
    </Shell>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || '(blank)';
  }
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <main style={{ font: '14px system-ui', padding: '2rem', maxWidth: 820 }}>
      <h1 style={{ margin: '0 0 .25rem' }}>Tabby</h1>
      {children}
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<Review />, root);
