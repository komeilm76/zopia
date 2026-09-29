import { describe, expect, it } from 'vitest';
import { formatZopiaWarning, formatZopiaWarningComment, normalizeZopiaWarnings, rebaseZopiaWarning } from '../src/warnings';
import { ZopiaError } from '../src/errors';

describe('exported warning helpers — branch coverage (round 9)', () => {
  it('normalizeZopiaWarnings rejects non-iterables and invalid members with typed errors', () => {
    expect(() => normalizeZopiaWarnings(null as any)).toThrow('warnings must be iterable');
    expect(() => normalizeZopiaWarnings([null as any])).toThrow('warning must be an object');
    expect(() => normalizeZopiaWarnings([[] as any])).toThrow('warning must be an object');
    expect(() => normalizeZopiaWarnings([{ code: 'ZOPIA_WARN_WEBHOOKS', at: '', message: 'm' }])).toThrow('warning location must be a non-empty string');
    expect(() => normalizeZopiaWarnings([{ code: 'ZOPIA_WARN_WEBHOOKS', at: 1 as any, message: 'm' }])).toThrow('warning location must be a non-empty string');
    expect(() => normalizeZopiaWarnings([{ code: 'ZOPIA_WARN_WEBHOOKS', message: '   \n  ' }])).toThrow('warning message must be a non-empty string');
    expect(() => normalizeZopiaWarnings([{ code: 'ZOPIA_WARN_WEBHOOKS', message: 3 as any }])).toThrow('warning message must be a non-empty string');
    for (const attempt of [
      () => normalizeZopiaWarnings(null as any),
      () => normalizeZopiaWarnings([null as any]),
    ]) try { attempt(); expect.unreachable(); } catch (error) { expect((error as ZopiaError).code).toBe('ZOPIA_WARNING_INVALID'); }
    // a hostile iterable that throws mid-iteration surfaces through asZopiaError
    expect(() => normalizeZopiaWarnings({ * [Symbol.iterator]() { yield { code: 'ZOPIA_WARN_WEBHOOKS', message: 'x' }; throw new Error('boom'); } })).toThrow('unable to normalize warnings');
  });

  it('normalizes messages to single safe lines and sorts deduplicated entries deterministically', () => {
    const normalized = normalizeZopiaWarnings(new Set([
      { code: 'ZOPIA_WARN_WEBHOOKS', message: '  webb  ' },
      { code: 'ZOPIA_WARN_WEBHOOKS', message: 'webb' },
      { code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/a', message: '\ta\nb\t' },
    ]));
    expect(normalized).toEqual([
      { code: 'ZOPIA_WARN_CUSTOM_FORMAT', at: '#/a', message: 'a b' },
      { code: 'ZOPIA_WARN_WEBHOOKS', message: 'webb' },
    ]);
  });

  it('rebaseZopiaWarning handles every pointer shape beneath the base', () => {
    const at = rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#/webhooks', message: 'm' }, '#/spec');
    expect(at.at).toBe('#/spec/webhooks');
    const root = rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', at: '#', message: 'm' }, '#/spec');
    expect(root.at).toBe('#/spec');
    const none = rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'm' } as any, '#/spec');
    expect(none.at).toBe('#/spec');
    const plain = rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', at: 'weird', message: 'm' }, '#/spec');
    expect(plain.at).toBe('#/specweird');
    expect(() => rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'm' }, 'spec')).toThrow('invalid warning base pointer');
    expect(() => rebaseZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'm' }, 1 as any)).toThrow('invalid warning base pointer');
  });

  it('formats one-line diagnostics and canonical comments with subject fallback', () => {
    expect(formatZopiaWarning({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'no location' } as any)).toBe('ZOPIA_WARN_WEBHOOKS: no location');
    expect(formatZopiaWarningComment({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'no location' } as any, '   \n ')).toBe('// @zopia:warn ZOPIA_WARN_WEBHOOKS schema — no location');
    expect(() => formatZopiaWarningComment({ code: 'ZOPIA_WARN_WEBHOOKS', message: 'm' }, 1 as any)).toThrow('warning subject must be a string');
  });
});
