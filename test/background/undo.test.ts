import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachSessionIds, recordClosed, undoLast } from '@/background/undo';
import { tab } from '../helpers';

// A chrome.sessions.Session for a closed tab. lastModified is in SECONDS.
function session(
  url: string,
  sessionId: string,
  lastModified: number,
): chrome.sessions.Session {
  return { lastModified, tab: { url, sessionId } as chrome.tabs.Tab };
}

const NOW = 1_000_000_000_000; // ms
const FRESH = NOW / 1000 - 1; // 1s ago, in seconds

describe('attachSessionIds (pure)', () => {
  const closed = (url: string) => ({ url, title: url, pinned: false });

  it('matches a closed url to the most-recent fresh session', () => {
    const out = attachSessionIds(
      [closed('https://a.com')],
      [
        session('https://other.com', 'old', FRESH),
        session('https://a.com', 'sess-a', FRESH),
      ],
      NOW,
      60_000,
    );
    expect(out[0].sessionId).toBe('sess-a');
  });

  it('ignores sessions older than the time window', () => {
    const stale = NOW / 1000 - 120; // 2 min ago
    const out = attachSessionIds(
      [closed('https://a.com')],
      [session('https://a.com', 'stale', stale)],
      NOW,
      60_000,
    );
    expect(out[0].sessionId).toBeUndefined();
  });

  it('maps duplicate urls to distinct sessions, most-recent first', () => {
    const out = attachSessionIds(
      [closed('https://a.com'), closed('https://a.com')],
      [
        session('https://a.com', 'newer', NOW / 1000 - 1),
        session('https://a.com', 'older', NOW / 1000 - 2),
      ],
      NOW,
      60_000,
    );
    // getRecentlyClosed is most-recent-first; each session used at most once.
    expect(out.map((t) => t.sessionId)).toEqual(['newer', 'older']);
  });

  it('leaves sessionId undefined when nothing matches', () => {
    const out = attachSessionIds(
      [closed('https://a.com')],
      [session('https://b.com', 'sess-b', FRESH)],
      NOW,
      60_000,
    );
    expect(out[0].sessionId).toBeUndefined();
  });
});

// --- recordClosed + undoLast against a fake chrome global -------------------

function fakeChrome(opts: {
  recentlyClosed?: chrome.sessions.Session[];
  hasSessions?: boolean;
} = {}) {
  const store: Record<string, unknown> = {};
  const restored: string[] = [];
  const created: Array<{ url?: string; pinned?: boolean }> = [];
  const fake: Record<string, unknown> = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        },
      },
    },
    tabs: {
      create: async (props: { url?: string; pinned?: boolean }) => {
        created.push(props);
        return {} as chrome.tabs.Tab;
      },
    },
  };
  if (opts.hasSessions !== false) {
    fake.sessions = {
      getRecentlyClosed: async () => opts.recentlyClosed ?? [],
      restore: async (id?: string) => {
        if (id === 'BOOM') throw new Error('expired');
        if (id) restored.push(id);
        return {} as chrome.sessions.Session;
      },
    };
  }
  return { fake, store, restored, created };
}

describe('recordClosed + undoLast', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('restores via chrome.sessions.restore when a session was captured', async () => {
    const { fake, restored, created } = fakeChrome({
      recentlyClosed: [session('https://a.com', 'sess-a', FRESH)],
    });
    vi.stubGlobal('chrome', fake);
    vi.setSystemTime(NOW);

    await recordClosed([tab({ url: 'https://a.com' })]);
    const n = await undoLast();

    expect(n).toBe(1);
    expect(restored).toEqual(['sess-a']);
    expect(created).toEqual([]); // history-preserving path, no fresh create
  });

  it('falls back to recreating the URL when no session matched', async () => {
    const { fake, restored, created } = fakeChrome({ recentlyClosed: [] });
    vi.stubGlobal('chrome', fake);
    vi.setSystemTime(NOW);

    await recordClosed([tab({ url: 'https://a.com', pinned: true })]);
    const n = await undoLast();

    expect(n).toBe(1);
    expect(restored).toEqual([]);
    expect(created).toEqual([{ url: 'https://a.com', pinned: true, active: false }]);
  });

  it('falls back to the URL when sessions.restore throws (expired session)', async () => {
    const { fake, created } = fakeChrome({
      recentlyClosed: [session('https://a.com', 'BOOM', FRESH)],
    });
    vi.stubGlobal('chrome', fake);
    vi.setSystemTime(NOW);

    await recordClosed([tab({ url: 'https://a.com' })]);
    const n = await undoLast();

    expect(n).toBe(1);
    expect(created).toEqual([{ url: 'https://a.com', pinned: false, active: false }]);
  });

  it('records (and restores) via plain create when chrome.sessions is absent', async () => {
    const { fake, created } = fakeChrome({ hasSessions: false });
    vi.stubGlobal('chrome', fake);
    vi.setSystemTime(NOW);

    await recordClosed([tab({ url: 'https://a.com' })]);
    const n = await undoLast();

    expect(n).toBe(1);
    expect(created).toEqual([{ url: 'https://a.com', pinned: false, active: false }]);
  });

  it('restores batches LIFO and returns 0 when empty', async () => {
    const { fake, created } = fakeChrome({ recentlyClosed: [] });
    vi.stubGlobal('chrome', fake);
    vi.setSystemTime(NOW);

    await recordClosed([tab({ url: 'https://first.com' })]);
    await recordClosed([tab({ url: 'https://second.com' })]);

    await undoLast();
    expect(created.at(-1)?.url).toBe('https://second.com');
    await undoLast();
    expect(created.at(-1)?.url).toBe('https://first.com');
    expect(await undoLast()).toBe(0);
  });
});
