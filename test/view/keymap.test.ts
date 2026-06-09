import { describe, expect, it } from 'vitest';

import { keymap } from '@/view/keymap';

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

  it('maps z to collapse-toggle on the current group', () => {
    expect(nav('z')).toEqual({ type: 'toggleCollapse' });
  });

  it('ignores unmapped keys', () => {
    expect(nav('q')).toBeNull();
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
