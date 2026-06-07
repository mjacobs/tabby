import { describe, expect, it } from 'vitest';

import { classifyUrl } from '@/core/urlCategory';

describe('classifyUrl', () => {
  it('classifies normal pages as web', () => {
    expect(classifyUrl('https://ex.com/p')).toBe('web');
    expect(classifyUrl('http://ex.com')).toBe('web');
  });

  it('classifies blank/new-tab/empty as blank', () => {
    expect(classifyUrl('')).toBe('blank');
    expect(classifyUrl('about:blank')).toBe('blank');
    expect(classifyUrl('about:newtab')).toBe('blank');
    expect(classifyUrl('chrome://newtab/')).toBe('blank');
    expect(classifyUrl('chrome://new-tab-page/')).toBe('blank');
    expect(classifyUrl('edge://newtab')).toBe('blank');
  });

  it('separates browser, extension, and file pages', () => {
    expect(classifyUrl('chrome://extensions')).toBe('browser');
    expect(classifyUrl('about:config')).toBe('browser');
    expect(classifyUrl('view-source:https://ex.com')).toBe('browser');
    expect(classifyUrl('chrome-extension://abc/page.html')).toBe('extension');
    expect(classifyUrl('moz-extension://abc/page.html')).toBe('extension');
    expect(classifyUrl('file:///home/u/x.pdf')).toBe('file');
  });

  it('falls back to other for the unrecognized/unparseable', () => {
    expect(classifyUrl('mailto:a@b.com')).toBe('other');
    expect(classifyUrl('not a url')).toBe('other');
  });
});
