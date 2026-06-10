import { afterEach, describe, expect, it, vi } from 'vitest';

import { stillOpenWindowIds } from '@/background/orchestrator';

afterEach(() => vi.unstubAllGlobals());

describe('stillOpenWindowIds', () => {
  it('drops windows Chrome already auto-closed (kata 0awf)', async () => {
    // Window 2 was emptied by consolidation and auto-closed; get() rejects.
    vi.stubGlobal('chrome', {
      windows: {
        get: vi.fn((id: number) =>
          id === 2
            ? Promise.reject(new Error('No window with id: 2'))
            : Promise.resolve({ id }),
        ),
      },
    });
    expect(await stillOpenWindowIds([1, 2, 3])).toEqual([1, 3]);
  });

  it('returns an empty list unchanged without touching chrome', async () => {
    const get = vi.fn();
    vi.stubGlobal('chrome', { windows: { get } });
    expect(await stillOpenWindowIds([])).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
