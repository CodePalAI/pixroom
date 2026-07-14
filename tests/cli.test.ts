import { describe, expect, it } from 'vitest';

import { parseProxyArgs } from '../src/cli/main.js';

describe('parseProxyArgs', () => {
  it('parses mode, host, and port', () => {
    expect(
      parseProxyArgs(['--mode', 'shadow', '--host', '0.0.0.0', '--port', '9000']),
    ).toEqual({
      ok: true,
      overrides: { mode: 'shadow', host: '0.0.0.0', port: 9000 },
    });
  });

  it('supports an ephemeral port for tests and embedders', () => {
    expect(parseProxyArgs(['-p', '0'])).toEqual({ ok: true, overrides: { port: 0 } });
  });

  it('rejects invalid modes, ports, and unknown flags', () => {
    expect(parseProxyArgs(['--mode', 'fast'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--port', '70000'])).toMatchObject({ ok: false });
    expect(parseProxyArgs(['--workers', '2'])).toEqual({
      ok: false,
      error: 'unknown proxy option: --workers',
    });
  });
});