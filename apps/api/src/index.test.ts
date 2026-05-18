import { describe, expect, it } from 'vitest';
import { app } from './index';

describe('@repo/api smoke', () => {
  it('module loads', async () => {
    const mod = await import('./index');
    expect(mod).toBeDefined();
    expect(mod.default).toBeTypeOf('function');
  });

  it('GET /health returns 200 with { ok: true }', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
