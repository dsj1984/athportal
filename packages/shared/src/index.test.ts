import { describe, expect, it } from 'vitest';

describe('@repo/shared smoke', () => {
  it('module loads', async () => {
    const mod = await import('./index');
    expect(mod).toBeDefined();
  });
});
