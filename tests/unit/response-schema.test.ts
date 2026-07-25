import { describe, expect, it } from 'vitest';
import {
  describeType,
  isRecord,
  looksLikePlayerResponseText,
  parsePlayerResponse,
} from '../../lib/player/response-schema';

describe('isRecord', () => {
  it.each([
    ['object', {}, true],
    ['object with fields', { a: 1 }, true],
    ['null', null, false],
    ['array', [], false],
    ['string', 's', false],
    ['number', 1, false],
    ['undefined', undefined, false],
  ])('%s → %s', (_name, value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe('describeType', () => {
  it('describes type without revealing value', () => {
    // ★ Privacy (§13): a SchemaViolation must never contain user data.
    expect(describeType(null)).toBe('null');
    expect(describeType([])).toBe('array');
    expect(describeType('secret')).toBe('string');
    expect(describeType(42)).toBe('number');
    expect(describeType({})).toBe('object');
    expect(describeType(undefined)).toBe('undefined');
    expect(describeType(true)).toBe('boolean');
  });
});

describe('looksLikePlayerResponseText', () => {
  it('avoids parsing unrelated text', () => {
    expect(looksLikePlayerResponseText('{"adaptiveFormats":[]}')).toBe(true);
    expect(looksLikePlayerResponseText('{"formats":[]}')).toBe(true);
    expect(looksLikePlayerResponseText('<html></html>')).toBe(false);
    expect(looksLikePlayerResponseText('')).toBe(false);
  });
});

describe('parsePlayerResponse', () => {
  it('produces a read-only view on required fields', () => {
    const input = {
      videoDetails: { videoId: 'abc', isLive: false },
      streamingData: {
        adaptiveFormats: [{ itag: 140 }],
        formats: [{ itag: 18 }],
      },
    };
    const result = parsePlayerResponse(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.root).toBe(input);
    expect(result.view.videoId).toBe('abc');
    expect(result.view.isLive).toBe(false);
    expect(result.view.hasDrm).toBe(false);
    expect(result.view.adaptiveFormats).toHaveLength(1);
    expect(result.view.formats).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it('distinguishes missing field from present empty field', () => {
    const result = parsePlayerResponse({ streamingData: { adaptiveFormats: [] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.adaptiveFormats).toEqual([]);
    expect(result.view.formats).toBeUndefined();
  });

  it('does not throw on hostile input', () => {
    expect(parsePlayerResponse(undefined).ok).toBe(false);
    expect(parsePlayerResponse(Symbol('x')).ok).toBe(false);
    expect(parsePlayerResponse(() => undefined).ok).toBe(false);
  });
});
