import { describe, expect, it } from 'vitest';
import {
  describeType,
  isRecord,
  looksLikePlayerResponseText,
  parsePlayerResponse,
} from '../../lib/player/response-schema';

describe('isRecord', () => {
  it.each([
    ['oggetto', {}, true],
    ['oggetto con campi', { a: 1 }, true],
    ['null', null, false],
    ['array', [], false],
    ['stringa', 's', false],
    ['numero', 1, false],
    ['undefined', undefined, false],
  ])('%s → %s', (_name, value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});

describe('describeType', () => {
  it('descrive il tipo senza rivelare il valore', () => {
    // ★ Privacy (§13): una SchemaViolation non deve mai contenere dati utente.
    expect(describeType(null)).toBe('null');
    expect(describeType([])).toBe('array');
    expect(describeType('segreto')).toBe('string');
    expect(describeType(42)).toBe('number');
    expect(describeType({})).toBe('object');
    expect(describeType(undefined)).toBe('undefined');
    expect(describeType(true)).toBe('boolean');
  });
});

describe('looksLikePlayerResponseText', () => {
  it("evita di parsare testo che non c'entra", () => {
    expect(looksLikePlayerResponseText('{"adaptiveFormats":[]}')).toBe(true);
    expect(looksLikePlayerResponseText('{"formats":[]}')).toBe(true);
    expect(looksLikePlayerResponseText('<html></html>')).toBe(false);
    expect(looksLikePlayerResponseText('')).toBe(false);
  });
});

describe('parsePlayerResponse', () => {
  it('produce una vista di sola lettura sui campi che ci servono', () => {
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

  it('distingue campo assente da campo presente e vuoto', () => {
    const result = parsePlayerResponse({ streamingData: { adaptiveFormats: [] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.adaptiveFormats).toEqual([]);
    expect(result.view.formats).toBeUndefined();
  });

  it('non lancia su input ostile', () => {
    expect(parsePlayerResponse(undefined).ok).toBe(false);
    expect(parsePlayerResponse(Symbol('x')).ok).toBe(false);
    expect(parsePlayerResponse(() => undefined).ok).toBe(false);
  });
});
