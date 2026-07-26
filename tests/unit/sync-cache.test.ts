/**
 * @vitest-environment happy-dom
 *
 * Synchronous cache is the mechanism allowing MAIN world to decide at
 * `document_start` without `await`. If it fails, either inline player response
 * is lost, or a tab user didn't activate gets filtered.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCachedDecision, writeCachedDecision } from '../../lib/sync-cache';

describe('synchronous decision cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ without info answer is NO: normal YouTube behavior', () => {
    expect(readCachedDecision()).toBe(false);
  });

  it('per-tab decision takes precedence', () => {
    writeCachedDecision(true, 'per-tab');
    expect(readCachedDecision()).toBe(true);

    writeCachedDecision(false, 'per-tab');
    expect(readCachedDecision()).toBe(false);
  });

  it('★ per-tab decision overrides always mode', () => {
    // User explicitly turned off this tab: must be respected.
    writeCachedDecision(false, 'always');
    expect(readCachedDecision()).toBe(false);
  });

  it('always mode decides for an untouched tab', () => {
    // As if another tab had written mode to localStorage.
    localStorage.setItem('ytao:mode', 'always');
    expect(readCachedDecision()).toBe(true);
  });

  it('off and per-tab modes do not activate an untouched tab', () => {
    localStorage.setItem('ytao:mode', 'off');
    expect(readCachedDecision()).toBe(false);
    localStorage.setItem('ytao:mode', 'per-tab');
    expect(readCachedDecision()).toBe(false);
  });

  it('ignores garbage values in per-tab key', () => {
    sessionStorage.setItem('ytao:tab-enabled', 'maybe');
    expect(readCachedDecision()).toBe(false);
  });

  it('★ does not throw if storage is restricted (privacy mode)', () => {
    const boom = (): never => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(() => readCachedDecision()).not.toThrow();
    expect(readCachedDecision()).toBe(false);
    expect(() => writeCachedDecision(true, 'always')).not.toThrow();
  });
});
