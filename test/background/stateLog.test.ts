import { afterEach, describe, expect, it, vi } from 'vitest';

import { dumpState, logState, pushToBuffer, serializeState } from '@/background/stateLog';
import type { WindowSnapshot } from '@/core/buildCleanupPlan';
import type { CanonicalSnapshot } from '@/shared/messages';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { Settings, TabInfo } from '@/shared/types';

function tab(p: Partial<TabInfo> & { id: number; index: number }): TabInfo {
  return {
    windowId: 1,
    url: `https://ex.com/${p.id}`,
    title: `t${p.id}`,
    pinned: false,
    audible: false,
    active: false,
    ...p,
  };
}

describe('serializeState (pure)', () => {
  const settings = DEFAULT_SETTINGS;

  it('orders windows by id and tabs by index, with a stable field set', () => {
    const windows: WindowSnapshot[] = [
      { id: 2, focused: true, tabs: [tab({ id: 9, index: 1 }), tab({ id: 8, index: 0 })] },
      { id: 1, focused: false, tabs: [tab({ id: 5, index: 0 })] },
    ];
    const snap = serializeState(windows, settings, null, 'orchestrator:before', 1234);

    expect(snap.label).toBe('orchestrator:before');
    expect(snap.capturedAt).toBe(1234);
    expect(snap.windows.map((w) => w.id)).toEqual([1, 2]);
    // window 2's tabs sorted by index → ids 8 then 9
    expect(snap.windows[1].tabs.map((t) => t.id)).toEqual([8, 9]);
    expect(Object.keys(snap.windows[1].tabs[0]).sort()).toEqual(
      [
        'active',
        'groupId',
        'id',
        'index',
        'lastAccessed',
        'pinned',
        'title',
        'urlNormalized',
        'urlRaw',
        'windowId',
      ].sort(),
    );
  });

  it('normalizes urlNormalized per settings (strips tracking params by default)', () => {
    const windows: WindowSnapshot[] = [
      {
        id: 1,
        focused: true,
        tabs: [tab({ id: 1, index: 0, url: 'https://ex.com/p?utm_source=x#frag' })],
      },
    ];
    const snap = serializeState(windows, settings, null, 'x', 0);
    expect(snap.windows[0].tabs[0].urlRaw).toBe('https://ex.com/p?utm_source=x#frag');
    expect(snap.windows[0].tabs[0].urlNormalized).toBe('https://ex.com/p');
  });
});

describe('pushToBuffer (pure)', () => {
  const snap = (label: string): CanonicalSnapshot => ({
    label,
    capturedAt: 0,
    windows: [],
    review: null,
  });

  it('appends and caps at the max, dropping oldest', () => {
    let buf: CanonicalSnapshot[] = [];
    for (let i = 0; i < 25; i++) buf = pushToBuffer(buf, snap(`s${i}`), 20);
    expect(buf).toHaveLength(20);
    expect(buf[0].label).toBe('s5'); // s0..s4 dropped
    expect(buf[19].label).toBe('s24');
  });
});

// --- logState / dumpState against a fake chrome global ----------------------

function fakeChrome(settings: Settings, windows: chrome.tabs.Tab[][]) {
  const session: Record<string, unknown> = {};
  return {
    runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
    storage: {
      sync: { get: async () => ({ settings }) },
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(session, obj);
        },
      },
    },
    windows: {
      getAll: async () =>
        windows.map((tabs, i) => ({ id: i + 1, focused: i === 0, tabs })),
    },
  };
}

function chromeTab(id: number, index: number): chrome.tabs.Tab {
  return {
    id,
    index,
    windowId: 1,
    url: `https://ex.com/${id}`,
    title: `t${id}`,
    pinned: false,
    active: false,
  } as chrome.tabs.Tab;
}

describe('logState', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a no-op when debugLogging is off (no buffer writes, no console)', async () => {
    const fake = fakeChrome({ ...DEFAULT_SETTINGS, debugLogging: false }, [
      [chromeTab(1, 0)],
    ]);
    vi.stubGlobal('chrome', fake);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await logState('orchestrator:before');

    expect(debugSpy).not.toHaveBeenCalled();
    const dump = await dumpState();
    expect(dump.buffer).toEqual([]);
    debugSpy.mockRestore();
  });

  it('records snapshots to the buffer when debugLogging is on', async () => {
    const fake = fakeChrome({ ...DEFAULT_SETTINGS, debugLogging: true }, [
      [chromeTab(1, 0), chromeTab(2, 1)],
    ]);
    vi.stubGlobal('chrome', fake);
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    await logState('orchestrator:before');
    await logState('orchestrator:after');

    const dump = await dumpState();
    expect(dump.buffer.map((s) => s.label)).toEqual([
      'orchestrator:before',
      'orchestrator:after',
    ]);
    // dumpState's `current` reflects live tabs regardless of buffer
    expect(dump.current.label).toBe('dumpState');
    expect(dump.current.windows[0].tabs.map((t) => t.id)).toEqual([1, 2]);
  });
});
