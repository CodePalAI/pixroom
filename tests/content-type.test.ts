import { describe, it, expect } from 'vitest';
import { classifyContent, dominantContentType } from '../src/policy/content-type.js';

describe('classifyContent', () => {
  it('detects JSON objects and arrays', () => {
    expect(classifyContent('{"a":1,"b":2,"c":3}')).toBe('json');
    expect(classifyContent('[{"id":1},{"id":2},{"id":3}]')).toBe('json');
  });

  it('detects structured logs', () => {
    const log = [
      '2024-01-02T10:00:00 INFO starting up',
      '2024-01-02T10:00:01 ERROR connection refused',
      '2024-01-02T10:00:02 WARN retrying in 5s',
    ].join('\n');
    expect(classifyContent(log)).toBe('log');
  });

  it('detects source code', () => {
    expect(classifyContent('function add(a, b) {\n  return a + b;\n}')).toBe('code');
    expect(classifyContent('import { foo } from "bar";\nexport const x = () => foo();')).toBe(
      'code',
    );
  });

  it('detects natural-language prose', () => {
    const prose =
      'The quick brown fox jumps over the lazy dog. It was a bright cold day in ' +
      'April, and the clocks were striking thirteen across the whole city.';
    expect(classifyContent(prose)).toBe('prose');
  });

  it('returns unknown for empty input', () => {
    expect(classifyContent('   ')).toBe('unknown');
  });
});

describe('dominantContentType', () => {
  it('returns the single type when uniform', () => {
    expect(dominantContentType(['{"a":1}', '{"b":2}', '{"c":3}'])).toBe('json');
  });

  it('returns mixed when no type holds a clear majority', () => {
    expect(dominantContentType(['{"key":"value","n":123}', 'Hello there friend'])).toBe('mixed');
  });

  it('returns unknown for no regions', () => {
    expect(dominantContentType([])).toBe('unknown');
  });
});
