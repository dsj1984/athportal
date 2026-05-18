import { describe, expect, it } from 'vitest';
import { app } from './index';

// Minimal stub binding — the unit smoke test does not assert on logger
// behavior (the contract test in middleware/ owns that). We just need
// `c.env.ANALYTICS.writeDataPoint` to exist so the middleware can fire.
const stubEnv = {
  ANALYTICS: { writeDataPoint: () => undefined },
};

describe('@repo/api smoke', () => {
  it('module loads', async () => {
    const mod = await import('./index');
    expect(mod).toBeDefined();
    expect(mod.default).toBeTypeOf('function');
  });

  it('GET /health returns 200 with { ok: true }', async () => {
    const res = await app.request('/health', {}, stubEnv);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
