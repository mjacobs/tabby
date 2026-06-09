import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKeymap, keymap } from '@/view/keymap';

describe('keymap (navigation mode)', () => {
  const nav = (key: string, mod = false) =>
    keymap({ key, ctrlKey: mod }, false);

  it('maps movement keys', () => {
    expect(nav('j')).toEqual({ type: 'move', delta: 1 });
    expect(nav('ArrowDown')).toEqual({ type: 'move', delta: 1 });
    expect(nav('k')).toEqual({ type: 'move', delta: -1 });
    expect(nav('g')).toEqual({ type: 'moveTo', to: 'top' });
    expect(nav('G')).toEqual({ type: 'moveTo', to: 'bottom' });
  });

  it('maps marking keys', () => {
    expect(nav('x')).toEqual({ type: 'toggleMark' });
    expect(nav(' ')).toEqual({ type: 'toggleMark' });
    expect(nav('V')).toEqual({ type: 'startVisual' });
    expect(nav('a')).toEqual({ type: 'markAll' });
    expect(nav('A')).toEqual({ type: 'clearMarks' });
  });

  it('distinguishes jump from commit by modifier', () => {
    expect(nav('Enter')).toEqual({ type: 'jump' });
    expect(keymap({ key: 'Enter', metaKey: true }, false)).toEqual({
      type: 'commit',
    });
    expect(keymap({ key: 'Enter', ctrlKey: true }, false)).toEqual({
      type: 'commit',
    });
  });

  it('maps filter, undo, help, escape', () => {
    expect(nav('/')).toEqual({ type: 'focusFilter' });
    expect(nav('u')).toEqual({ type: 'undo' });
    expect(nav('?')).toEqual({ type: 'toggleHelp' });
    expect(nav('Escape')).toEqual({ type: 'escape' });
  });

  it('ignores unmapped keys', () => {
    expect(nav('z')).toBeNull();
  });
});

describe('keymap (filtering mode)', () => {
  const filt = (key: string) => keymap({ key }, true);

  it('only Enter/Escape act; typing passes through', () => {
    expect(filt('Enter')).toEqual({ type: 'setFiltering', on: false });
    expect(filt('Escape')).toEqual({ type: 'setFiltering', on: false });
    expect(filt('a')).toBeNull();
    expect(filt('j')).toBeNull();
  });
});

describe('keymap gg two-key sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('g then g jumps to top', () => {
    const handle = createKeymap(
      (fn, ms) => setTimeout(fn, ms),
      (id) => clearTimeout(id),
    );
    // First g: immediate jump to top
    expect(handle({ key: 'g' }, false)).toEqual({ type: 'moveTo', to: 'top' });
    // Second g within window: also jump to top (gg sequence)
    expect(handle({ key: 'g' }, false)).toEqual({ type: 'moveTo', to: 'top' });
  });

  it('g then j does NOT jump back to top (j moves cursor down normally)', () => {
    const handle = createKeymap(
      (fn, ms) => setTimeout(fn, ms),
      (id) => clearTimeout(id),
    );
    // First g: jump to top
    expect(handle({ key: 'g' }, false)).toEqual({ type: 'moveTo', to: 'top' });
    // j after g cancels the pending sequence and is handled as a normal move
    expect(handle({ key: 'j' }, false)).toEqual({ type: 'move', delta: 1 });
  });

  it('G jumps to bottom', () => {
    const handle = createKeymap(
      (fn, ms) => setTimeout(fn, ms),
      (id) => clearTimeout(id),
    );
    expect(handle({ key: 'G' }, false)).toEqual({ type: 'moveTo', to: 'bottom' });
  });

  it('timeout expiry cancels the pending sequence (no second jump)', () => {
    const handle = createKeymap(
      (fn, ms) => setTimeout(fn, ms),
      (id) => clearTimeout(id),
    );
    // First g: jump to top, pending sequence armed
    expect(handle({ key: 'g' }, false)).toEqual({ type: 'moveTo', to: 'top' });
    // Advance past the 400 ms timeout — pending state is cleared
    vi.advanceTimersByTime(401);
    // After timeout, 'j' is handled normally (no top-jump side effect)
    expect(handle({ key: 'j' }, false)).toEqual({ type: 'move', delta: 1 });
  });

  it('lone g still jumps to top immediately (alias not regressed)', () => {
    const handle = createKeymap(
      (fn, ms) => setTimeout(fn, ms),
      (id) => clearTimeout(id),
    );
    expect(handle({ key: 'g' }, false)).toEqual({ type: 'moveTo', to: 'top' });
  });
});
